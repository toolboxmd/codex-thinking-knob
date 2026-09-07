import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopBridge } from '../src/desktop-bridge.mjs';
import { createControl } from '../src/control.mjs';
import { sendControl } from '../src/mcp.mjs';
import { stat, access } from 'node:fs/promises';

function setup(options = {}) {
  const child = [], client = [];
  const b = createDesktopBridge({ toChild: m => child.push(m), toClient: m => client.push(m), ...options });
  function rpc(method, params, result) {
    b.client({ id: 1, method, params });
    const request = child.at(-1);
    b.server({ id: request.id, result });
    return request;
  }
  rpc('initialize', {}, {});
  const start = (id = 'a', model = 'gpt-6-astra') => {
    rpc('thread/resume', { threadId: id }, { thread: { id, turns: [] }, model });
    rpc('turn/start', { threadId: id, effort: 'max' }, { turn: { id: `${id}-turn` } });
  };
  start();
  return { b, child, client, rpc, start };
}
const request = { threadId: 'a', turnId: 'a-turn', effort: 'low' };

test('resumed task adapts despite initial UI effort and keeps client IDs and callbacks intact', async () => {
  const { b, child, client } = setup();
  const change = b.setEffort(request);
  const update = child.at(-1);
  assert.deepEqual(update.params, request);
  b.server({ id: update.id, result: { status: 'applied' } });
  assert.deepEqual(await change, { status: 'applied', effort: 'low', executionVerified: false });
  b.server({ id: 'callback', method: 'item/tool/call', params: { tool: 'other' } });
  assert.equal(client.at(-1).id, 'callback');
  b.client({ id: 'callback', result: { success: true } });
  assert.equal(child.at(-1).id, 'callback');
  assert.equal(client[0].id, 1);
  b.close();
});

test('rejects other turns, non-Astra tasks, allowlist misses, and completed turns', async () => {
  const { b, start } = setup({ allowedThreads: new Set(['a']) });
  start('b'); start('c', 'gpt-5.6-luna');
  for (const r of [{ ...request, turnId: 'old' }, { threadId: 'b', turnId: 'b-turn', effort: 'high' }, { threadId: 'c', turnId: 'c-turn', effort: 'high' }]) {
    assert.equal((await b.setEffort(r)).status, 'targetUnavailable');
  }
  b.server({ method: 'turn/completed', params: { threadId: 'a', turn: { id: 'a-turn' } } });
  assert.equal((await b.setEffort(request)).status, 'targetUnavailable'); b.close();
});

test('explicit desktop setting locks only that task and survives resume', async () => {
  const { b, start, child } = setup(); start('b');
  b.client({ id: 'manual', method: 'turn/settings/update', params: { threadId: 'a', effort: 'high' } });
  assert.equal((await b.setEffort(request)).status, 'fixedPolicy');
  start(); assert.equal((await b.setEffort(request)).status, 'fixedPolicy');
  const other = b.setEffort({ threadId: 'b', turnId: 'b-turn', effort: 'medium' });
  b.server({ id: child.at(-1).id, result: { status: 'applied' } });
  assert.equal((await other).status, 'applied'); b.close();
});

test('timeout and disconnect never claim success; late replies do not reach desktop', async () => {
  const { b, child, client } = setup({ timeoutMs: 5 });
  const change = b.setEffort(request), id = child.at(-1).id;
  assert.equal((await change).status, 'timeout');
  const count = client.length;
  b.server({ id, result: { status: 'applied' } }); assert.equal(client.length, count);
  const next = b.setEffort(request); b.close();
  assert.equal((await next).status, 'disconnected');
});

test('private control socket authenticates and cleans its owned path', async () => {
  let calls = 0;
  const control = await createControl(async r => { calls++; return { status: 'applied', effort: r.effort, executionVerified: false }; });
  try {
    assert.equal((await stat(control.socket)).mode & 0o777, 0o600);
    const invalid = await sendControl({ ...request, token: 'wrong' }, { socketPath: control.socket });
    assert.equal(invalid.status, 'rejected'); assert.equal(calls, 0);
    const valid = await sendControl({ ...request, token: control.token }, { socketPath: control.socket });
    assert.equal(valid.status, 'applied'); assert.equal(calls, 1);
  } finally { await control.close(); }
  await assert.rejects(access(control.socket));
});
