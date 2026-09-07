import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { requestFromCall, sendControl, MAX_BYTES } from '../src/mcp.mjs';

const metadata = { threadId: 'thread-1', 'x-codex-turn-metadata': { thread_id: 'thread-1', turn_id: 'turn-1' } };
const params = () => ({ name: 'set_effort', arguments: { effort: 'low', reason: 'Implementation' }, _meta: structuredClone(metadata) });
async function control(t, handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'knob-mcp-'));
  const socketPath = path.join(dir, 'control.sock');
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handler(socket); });
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return socketPath;
}
function client(t, env = {}) {
  const child = spawn(process.execPath, [new URL('../bin/thinking-knob-mcp.mjs', import.meta.url).pathname], { env: { ...process.env, KNOB_CONTROL_SOCKET: '', KNOB_CONTROL_TOKEN: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let buffer = '';
  const waiting = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const response = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const resolve = waiting.get(response.id);
      if (resolve) { waiting.delete(response.id); resolve(response); }
    }
  });
  return {
    child,
    request(method, args, id = 1) { return new Promise(resolve => { waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: args })}\n`); }); },
    raw(text, id = null) { return new Promise(resolve => { waiting.set(id, resolve); child.stdin.write(text); }); },
  };
}

test('MCP stdio initialization, discovery, and trusted socket control', { timeout: 5000 }, async t => {
  let observed;
  const socketPath = await control(t, socket => socket.once('data', bytes => {
    observed = JSON.parse(bytes.toString());
    socket.end(`${JSON.stringify({ status: 'applied', effort: observed.effort, executionVerified: false })}\n`);
  }));
  const mcp = client(t, { KNOB_CONTROL_SOCKET: socketPath, KNOB_CONTROL_TOKEN: 'private-token' });
  const init = await mcp.request('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  mcp.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const list = await mcp.request('tools/list', {});
  assert.equal(list.result.tools[0].name, 'set_effort');
  assert.deepEqual(Object.keys(list.result.tools[0].inputSchema.properties), ['effort', 'reason']);
  const result = await mcp.request('tools/call', params());
  assert.equal(result.result.isError, false);
  assert.equal(JSON.parse(result.result.content[0].text).executionVerified, false);
  assert.equal(observed.threadId, 'thread-1');
  assert.equal(observed.turnId, 'turn-1');
  assert.equal(observed.token, 'private-token');
  assert.deepEqual(Object.keys(observed).sort(), ['effort', 'reason', 'threadId', 'token', 'turnId']);
});

test('identity cannot come from arguments or inconsistent metadata', () => {
  for (const mutate of [p => delete p._meta, p => delete p._meta['x-codex-turn-metadata'], p => { p._meta.threadId = 'another'; }, p => { p._meta['x-codex-turn-metadata'].turn_id = ''; }, p => { p.arguments.threadId = 'thread-1'; }, p => { p._meta['x-codex-turn-metadata'] = JSON.stringify(metadata['x-codex-turn-metadata']); }]) {
    const p = params(); mutate(p); assert.throws(() => requestFromCall(p, 'token'));
  }
  for (const effort of ['low', 'medium', 'high', 'max']) assert.equal(requestFromCall({ ...params(), arguments: { effort } }, 'token').effort, effort);
  assert.throws(() => requestFromCall({ ...params(), arguments: { effort: 'xhigh' } }, 'token'));
  assert.throws(() => requestFromCall({ ...params(), arguments: { effort: 'low', reason: 'x'.repeat(501) } }, 'token'));
});

test('stdio reports absent activation and malformed identity as failed calls', { timeout: 5000 }, async t => {
  const mcp = client(t);
  for (const p of [params(), { ...params(), _meta: {} }]) {
    const response = await mcp.request('tools/call', p);
    assert.equal(response.result.isError, true);
    assert.equal(JSON.parse(response.result.content[0].text).executionVerified, false);
  }
  assert.equal((await mcp.raw('{bad json}\n')).error.code, -32700);
  assert.equal((await mcp.request('unknown', {})).error.code, -32601);
  assert.deepEqual((await mcp.request('ping', {})).result, {});
});

test('control transport bounds missing sockets, timeout, EOF, and response size', { timeout: 5000 }, async t => {
  const request = requestFromCall(params(), 'token');
  await assert.rejects(sendControl(request, { socketPath: '/nonexistent/thinking-knob.sock' }), /connection failed/);
  const silent = await control(t, () => {});
  await assert.rejects(sendControl(request, { socketPath: silent, timeoutMs: 25 }), /acceptance is unknown/);
  const ended = await control(t, socket => socket.end());
  await assert.rejects(sendControl(request, { socketPath: ended }), /without a result/);
  const large = await control(t, socket => socket.end('x'.repeat(MAX_BYTES + 1)));
  await assert.rejects(sendControl(request, { socketPath: large }), /Oversized/);
});

test('only applied with matching effort and unverified execution is success', { timeout: 5000 }, async t => {
  for (const response of [ { status: 'rejected', effort: 'low', executionVerified: false }, { status: 'applied', effort: 'high', executionVerified: false }, { status: 'applied', effort: 'low', executionVerified: true } ]) {
    const socketPath = await control(t, socket => socket.once('data', () => socket.end(`${JSON.stringify(response)}\n`)));
    const mcp = client(t, { KNOB_CONTROL_SOCKET: socketPath, KNOB_CONTROL_TOKEN: 'token' });
    assert.equal((await mcp.request('tools/call', params())).result.isError, true);
  }
});

test('stdio rejects oversized input without invoking a tool', { timeout: 5000 }, async t => {
  const mcp = client(t);
  const result = await mcp.raw('x'.repeat(MAX_BYTES + 1));
  assert.equal(result.error.code, -32600);
});
