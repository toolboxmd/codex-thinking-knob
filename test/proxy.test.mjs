import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createBridge, TOOL_NAME, EFFORTS } from '../src/bridge.mjs';

function harness(options = {}) {
  const child = [], client = [];
  const bridge = createBridge({ adaptive: true, toChild: m => child.push(m), toClient: m => client.push(m), ...options });
  function request(method, params, result) {
    bridge.client({ id: 1, method, params });
    const sent = child.at(-1);
    if (result !== undefined) bridge.server({ id: sent.id, result });
    return sent;
  }
  function start(params = {}, model = 'gpt-6-astra') {
    request('initialize', { capabilities: { other: true } }, {});
    request('thread/start', { model: 'gpt-6-astra', ...params }, { thread: { id: 't' }, model });
  }
  function turn(params = {}) {
    request('turn/start', { threadId: 't', ...params }, { turn: { id: 'v' } });
  }
  function call(args = { effort: 'high' }, params = {}) {
    bridge.server({ id: 1, method: 'item/tool/call', params: { threadId: 't', turnId: 'v', callId: 'c', namespace: null, tool: TOOL_NAME, arguments: args, ...params } });
    return child.at(-1);
  }
  return { bridge, child, client, request, start, turn, call };
}
const output = message => JSON.parse(message.result.contentItems[0].text);

test('default passthrough preserves messages including callbacks and IDs', () => {
  const h = harness({ adaptive: false });
  const request = { id: 'thinking-knob:1', method: 'thread/start', params: { model: 'gpt-6-astra' } };
  h.bridge.client(request); h.bridge.server(request);
  assert.deepEqual(h.child, [request]); assert.deepEqual(h.client, [request]);
  h.bridge.close();
});
test('capability and tool registration preserve unrelated fields and reject collisions', () => {
  const h = harness(); h.start({ developerInstructions: null, dynamicTools: [{ type: 'function', name: 'other' }] });
  assert.deepEqual(h.child[0].params.capabilities, { other: true, experimentalApi: true });
  const params = h.child[1].params;
  assert.equal(params.developerInstructions, null);
  assert.equal(params.dynamicTools[0].name, 'other'); assert.equal(params.dynamicTools[1].name, TOOL_NAME);
  for (const dynamicTools of [[{ name: TOOL_NAME }], [{ type: 'namespace', name: 'x', tools: [{ name: TOOL_NAME }] }]]) {
    const before = h.child.length; h.request('thread/start', { model: 'gpt-6-astra', dynamicTools });
    assert.equal(h.child.length, before); assert.equal(h.client.at(-1).error.code, -32602);
  }
  h.bridge.close();
  const off = harness(); off.request('initialize', { capabilities: { experimentalApi: false } });
  assert.equal(off.child.length, 0); assert.match(off.client[0].error.message, /incompatible/);
});
test('four efforts bind only server IDs and distinguish application from inference', () => {
  const h = harness(); h.start(); h.turn();
  for (const effort of EFFORTS) {
    const native = h.call({ effort, reason: 'Deterministic fixture' });
    assert.equal(native.method, 'turn/settings/update');
    assert.deepEqual(native.params, { threadId: 't', turnId: 'v', effort });
    h.bridge.server({ id: native.id, result: { status: 'applied' } });
    assert.equal(h.child.at(-1).result.success, true);
    assert.equal(output(h.child.at(-1)).executionVerified, false);
  }
  h.bridge.close();
});
test('invalid arguments cannot select arbitrary targets', () => {
  const h = harness(); h.start(); h.turn();
  for (const args of [null, [], 'high', {}, { effort: 'ultra' }, { effort: 'high', threadId: 'other' }, { effort: 'high', reason: 1 }, { effort: 'high', reason: 'x'.repeat(501) }]) {
    const result = h.call(args); assert.equal(result.result.success, false); assert.equal(output(result).status, 'invalidArguments');
  }
  h.bridge.close();
});
test('unknown, stale, completed, fixed, incompatible and resumed targets never update', () => {
  for (const setup of [
    h => h.turn({ effort: 'low' }),
    h => h.turn({ collaborationMode: { mode: 'plan', settings: { model: 'gpt-6-astra' } } }),
    h => h.turn({ model: 'gpt-5.6-luna' }),
    h => { h.turn(); h.bridge.server({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'v' } } }); },
    h => { h.turn(); h.request('turn/settings/update', { threadId: 't', turnId: 'v', effort: 'max' }); },
    h => { h.turn(); h.request('turn/settings/update', { threadId: 't', turnId: 'v', model: 'gpt-5.6-luna' }); },
    h => { h.turn(); h.request('thread/resume', { threadId: 't' }); },
    h => { h.turn(); h.request('thread/settings/update', { threadId: 't', model: 'gpt-5.6-luna' }); },
    h => { h.turn(); h.bridge.server({ method: 'model/rerouted', params: { threadId: 't', turnId: 'v', toModel: 'gpt-5.6-luna' } }); },
    h => { h.turn(); h.bridge.server({ method: 'thread/settings/updated', params: { threadId: 't', threadSettings: { model: 'gpt-5.6-luna' } } }); },
  ]) {
    const h = harness(); h.start(); setup(h); const response = h.call();
    assert.equal(response.result.success, false); assert.equal(output(response).status, 'targetUnavailable'); h.bridge.close();
  }
  const h = harness(); h.start(); h.turn(); assert.equal(output(h.call({ effort: 'low' }, { turnId: 'stale' })).status, 'targetUnavailable');
  const before = h.child.length; h.call({ effort: 'low' }, { threadId: 'unknown' }); assert.equal(h.child.length, before); assert.equal(h.client.at(-1).method, 'item/tool/call'); h.bridge.close();
  const incompatible = harness(); incompatible.start({}, 'gpt-5.6-luna'); incompatible.turn(); assert.equal(incompatible.call().result.success, false); incompatible.bridge.close();
});
test('non-Astra and unknown default starts are not injected; resumed persisted tools are not claimed', () => {
  const h = harness(); h.request('initialize', {}, {});
  for (const model of [undefined, 'gpt-5.6-luna']) {
    const sent = h.request('thread/start', { model }, { thread: { id: 't' }, model: 'gpt-6-astra' }); assert.equal(sent.params.dynamicTools, undefined);
  }
  h.request('thread/resume', { threadId: 't', model: 'gpt-6-astra' }, { thread: { id: 't' }, model: 'gpt-6-astra' });
  const count = h.child.length; h.call(); assert.equal(h.child.length, count); assert.equal(h.client.at(-1).method, 'item/tool/call'); h.bridge.close();
});
test('IDs cannot collide across client requests, internal updates, and server callbacks', () => {
  const h = harness(); h.start(); h.turn();
  const native = h.call();
  h.bridge.client({ id: native.id, method: 'ping', params: {} }); const external = h.child.at(-1);
  h.bridge.server({ id: native.id, method: 'approval', params: {} });
  assert.equal(h.client.at(-1).id, native.id);
  h.bridge.client({ id: native.id, result: { approved: true } }); assert.deepEqual(h.child.at(-1), { id: native.id, result: { approved: true } });
  h.bridge.server({ id: external.id, result: 'pong' }); assert.deepEqual(h.client.at(-1), { id: native.id, result: 'pong' });
  h.bridge.server({ id: native.id, result: { status: 'applied' } }); assert.equal(h.child.at(-1).result.success, true);
  h.bridge.close();
});
test('native error, unavailable and timeout report failure; late replies never leak', async () => {
  const h = harness({ timeoutMs: 5 }); h.start(); h.turn();
  let native = h.call(); h.bridge.server({ id: native.id, error: { code: -1, message: 'no' } }); assert.equal(output(h.child.at(-1)).status, 'nativeError');
  native = h.call(); h.bridge.server({ id: native.id, result: { status: 'targetUnavailable' } }); assert.equal(h.child.at(-1).result.success, false);
  native = h.call(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(output(h.child.at(-1)).status, 'timeout');
  const count = h.client.length; h.bridge.server({ id: native.id, result: { status: 'applied' } }); assert.equal(h.client.length, count); h.bridge.close();
});
test('started notification supports tool calls before the turn/start response, completion prevents resurrection', () => {
  const h = harness(); h.start(); const sent = h.request('turn/start', { threadId: 't' });
  h.bridge.server({ method: 'turn/started', params: { threadId: 't', turn: { id: 'v' } } });
  assert.equal(h.call().method, 'turn/settings/update');
  h.bridge.server({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'v' } } });
  h.bridge.server({ id: sent.id, result: { turn: { id: 'v' } } }); assert.equal(h.call().result.success, false); h.bridge.close();
});
test('explicit effort remains fixed on future turns and cancellation IDs remap', () => {
  const h = harness(); h.start(); h.turn({ effort: 'high' }); h.turn(); assert.equal(h.call().result.success, false);
  const sent = h.request('ping', {}); h.bridge.client({ method: '$/cancelRequest', params: { id: 1 } }); assert.equal(h.child.at(-1).params.id, sent.id); h.bridge.close();
});
test('switching models and back keeps adaptation disabled; unchanged Astra stays eligible', t => {
  const h = harness(); t.after(() => h.bridge.close()); h.start(); h.turn({ model: 'gpt-6-astra' });
  const initial = h.call();
  assert.equal(initial.method, 'turn/settings/update');
  h.bridge.server({ id: initial.id, result: { status: 'applied' } });
  h.turn({ model: 'gpt-5.6-luna' });
  h.turn({ model: 'gpt-6-astra' });
  const denied = h.call();
  assert.equal(denied.result?.success, false);
  assert.equal(output(denied).status, 'targetUnavailable');
  h.bridge.close();
});
async function runCli(args, input = '') {
  const child = spawn(process.execPath, ['bin/codex-thinking-knob.mjs', ...args], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const [code] = await once(child, 'exit'); return { code, stdout, stderr };
}
test('CLI help, argument validation, failed child and EOF terminate', async () => {
  assert.match((await runCli(['--help'])).stdout, /Usage:/);
  assert.equal((await runCli(['--timeout-ms', '0'])).code, 2);
  assert.equal((await runCli(['--'])).code, 2);
  assert.equal((await runCli(['--', '/nonexistent-thinking-knob-test-child'])).code, 1);
  const eof = await runCli(['--', process.execPath, '-e', 'setInterval(()=>{},1000)']); assert.equal(eof.code, 0);
  const exit = spawn(process.execPath, ['bin/codex-thinking-knob.mjs', '--', process.execPath, '-e', 'process.exit(7)'], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal((await once(exit, 'exit'))[0], 7);
});

test('namespaced matching tools and ordinary notifications remain client-owned', () => {
  const h = harness(); h.start(); h.turn();
  const count = h.child.length;
  h.call({ effort: 'high' }, { namespace: 'external' });
  assert.equal(h.child.length, count); assert.equal(h.client.at(-1).params.namespace, 'external');
  const notification = { method: 'item/started', params: { threadId: 't', item: { id: 'i' } } };
  h.bridge.server(notification); assert.deepEqual(h.client.at(-1), notification);
  h.bridge.close();
});
test('failed initialization cannot activate injection and closing clears owned timers', async () => {
  const h = harness({ timeoutMs: 5 });
  const init = h.request('initialize', {});
  h.bridge.server({ id: init.id, error: { code: -1, message: 'unsupported' } });
  const count = h.child.length; h.request('thread/start', { model: 'gpt-6-astra' });
  assert.equal(h.child.length, count); assert.equal(h.client.at(-1).error.code, -32602);
  h.start(); h.turn(); h.call(); h.bridge.close();
  const after = h.child.length;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(h.child.length, after);
});
test('CLI shutdown stays bounded when its child ignores termination', { timeout: 4000 }, async () => {
  const child = spawn(process.execPath, ['bin/codex-thinking-knob.mjs', '--', process.execPath, '-e',
    "process.on('SIGTERM',()=>{}); process.stdout.write(JSON.stringify({method:'ready'})+'\\n'); setInterval(()=>{},1000)"],
    { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  child.stdin.end();
  assert.equal((await once(child, 'exit'))[0], 0);
});
