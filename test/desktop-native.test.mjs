import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const binary = process.env.KNOB_NATIVE_BINARY;
const launcher = fileURLToPath(new URL('../bin/codex-thinking-knob-desktop.mjs', import.meta.url));

test('desktop task preserves effort control and history across interruption, restart, and wrapper removal', {
  skip: !binary && 'Set KNOB_NATIVE_BINARY to the Codex 0.153.4 executable',
  timeout: 45000,
}, async t => {
  assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8' }), /0\.153\.4\b/);
  const dir = await mkdtemp(join(tmpdir(), 'thinking-knob-native-'));
  let child;
  let server;
  let childClosed = Promise.resolve();
  // Stop every fixture-owned process before deleting its writable profile.
  // A single hook also cleans up when an assertion or an earlier setup step fails.
  t.after(async () => {
    if (child?.pid) {
      const signalGroup = signal => {
        try { process.kill(-child.pid, signal); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      };
      signalGroup('SIGTERM');
      const force = setTimeout(() => signalGroup('SIGKILL'), 3000);
      try { await childClosed; } finally { clearTimeout(force); }
    }
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const home = join(dir, 'codex');
  const cwd = join(dir, 'work');
  await mkdir(home); await mkdir(cwd);
  const fixtureEnv = { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home };
  const requests = [];
  let adapting = false, holdResponse = false, providerStarted;
  const heldRequest = new Promise(resolve => { providerStarted = resolve; });
  server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/responses') {
      res.writeHead(404); res.end(); return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (holdResponse) { providerStarted(); return; }
    requests.push(input);
    const index = requests.length;
    const item = adapting && index <= 2
      ? { type: 'custom_tool_call', id: `fc_${index}`, call_id: `call_${index}`, name: 'exec', namespace: 'functions', input: `text(await tools.mcp__thinking_knob__set_effort({effort:'${index === 1 ? 'high' : 'low'}'}));` }
      : { type: 'message', id: `msg_${index}`, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'Fixture complete.', annotations: [] }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    emit({ type: 'response.created', response: { id: `resp_${index}`, status: 'in_progress', output: [] } });
    emit({ type: 'response.output_item.added', output_index: 0, item });
    emit({ type: 'response.output_item.done', output_index: 0, item });
    emit({ type: 'response.completed', response: { id: `resp_${index}`, status: 'completed',
      output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(home, 'config.toml'), `cli_auth_credentials_store = "file"
model = "gpt-6-astra"
model_provider = "fixture"
model_reasoning_effort = "low"
approval_policy = "never"
sandbox_mode = "read-only"
[model_providers.fixture]
name = "Local deterministic fixture"
base_url = "http://127.0.0.1:${server.address().port}"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`);
  const market = join(dir, 'marketplace');
  await mkdir(join(market, '.agents', 'plugins'), { recursive: true });
  const source = join(market, 'plugins', 'codex-thinking-knob');
  await mkdir(source, { recursive: true });
  for (const part of ['bin', 'src', '.codex-plugin', '.mcp.json', 'package.json', 'VERSION', 'skills', 'docs', 'README.md']) {
    await cp(fileURLToPath(new URL('../' + part, import.meta.url)), join(source, part), { recursive: true });
  }
  await writeFile(join(market, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: 'knob-fixture', interface: { displayName: 'Isolated test' }, plugins: [{
      name: 'codex-thinking-knob', source: { source: 'local', path: './plugins/codex-thinking-knob' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools',
    }],
  }));
  for (const args of [['plugin', 'marketplace', 'add', market], ['plugin', 'add', 'codex-thinking-knob@knob-fixture']]) {
    execFileSync(binary, args, { env: fixtureEnv, stdio: 'pipe' });
  }
  // Create a persisted task before the adapter exists, then resume it through
  // the adapter. No dynamic tool registration or replacement conversation.
  const native = spawn(binary, ['app-server'], {
    cwd, env: fixtureEnv, stdio: ['pipe','pipe','ignore'],
  });
  const nativeClosed = new Promise(resolve => native.once('close', resolve));
  const waits = new Map();
  let nativeCompleted;
  const completionBefore = new Promise(resolve => { nativeCompleted = resolve; });
  createInterface({ input: native.stdout }).on('line', line => {
    const m = JSON.parse(line); if (m.method === 'turn/completed') nativeCompleted(m); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  });
  let nativeId = 0;
  const nativeRpc = (method, params) => new Promise(resolve => {
    const id = ++nativeId; waits.set(id, resolve);
    native.stdin.write(JSON.stringify({id, method, params}) + '\n');
  });
  let existing;
  try {
    await nativeRpc('initialize', { clientInfo: { name: 'before_knob', version: '1' } });
    existing = await nativeRpc('thread/start', { model: 'gpt-6-astra', cwd });
    assert.ok(existing.result?.thread?.id, JSON.stringify(existing));
    await nativeRpc('turn/start', { threadId: existing.result.thread.id, input: [{ type: 'text', text: 'Create a retained conversation.', text_elements: [] }] });
    assert.equal((await completionBefore).params.turn.status, 'completed');
  } finally {
    native.kill('SIGTERM');
    const force = setTimeout(() => native.kill('SIGKILL'), 2000);
    try { await nativeClosed; } finally { clearTimeout(force); }
  }
  adapting = true; requests.length = 0;
  function connect(wrapped = true) {
    child = spawn(wrapped ? process.execPath : binary, wrapped
      ? [launcher, '-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled']
      : ['-c', 'features.code_mode_host=true', 'app-server'], {
      cwd, env: { ...fixtureEnv, KNOB_NATIVE_BINARY: binary, KNOB_ADAPTIVE_THREAD: existing.result.thread.id }, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    });
    childClosed = new Promise(resolve => child.once('close', resolve));
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const pending = new Map();
    const events = [];
    const eventWaiters = [];
    createInterface({ input: child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else {
        events.push(message);
        for (const waiter of [...eventWaiters]) if (waiter.predicate(message)) waiter.resolve(message);
        // The wrapper must handle its dynamic calls; anything else is a failure.
        if (message.method && message.id !== undefined) {
          child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unexpected server request in fixture' } }) + '\n');
        }
      }
    });
    child.on('exit', (code, signal) => {
      for (const { reject } of pending.values()) reject(new Error(`Wrapper exited ${code ?? signal}: ${stderr}`));
    });
    let nextId = 0;
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    const event = predicate => {
      const found = events.find(predicate);
      return found ? Promise.resolve(found) : new Promise(resolve => eventWaiters.push({ predicate, resolve }));
    };
    return { rpc, event };
  }
  async function disconnect() {
    child.stdin.end();
    const force = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }, 3000);
    try { await childClosed; } finally { clearTimeout(force); }
    child = undefined;
  }
  let { rpc, event } = connect();
  await rpc('initialize', { clientInfo: { name: 'thinking_knob_fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/resume', { threadId: existing.result.thread.id, cwd });
  assert.equal(started.thread.id, existing.result.thread.id);
  assert.equal(started.model, 'gpt-6-astra');
  const threadId = started.thread.id;
  const turn = await rpc('turn/start', { threadId, effort: 'low', input: [{ type: 'text', text: 'Exercise the local protocol fixture.', text_elements: [] }] });
  const completion = await event(m => m.method === 'turn/completed' && m.params.turn.id === turn.turn.id);
  assert.equal(completion.params.turn.status, 'completed', JSON.stringify(completion));
  assert.deepEqual(requests.map(r => r.reasoning.effort), ['low','high','low']);
  const output = requests.at(-1).input.filter(x => x.type.endsWith('_output'));
  assert.match(JSON.stringify(output), /applied/);
  assert.doesNotMatch(JSON.stringify(output), /targetUnavailable|fixedPolicy|notActivated/);

  // Interrupt while a real provider request is pending, then retain the saved
  // user message along with both completed turns through two process restarts.
  holdResponse = true;
  const interrupted = await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'Retain this interrupted request.', text_elements: [] }] });
  await heldRequest;
  await rpc('turn/interrupt', { threadId, turnId: interrupted.turn.id });
  assert.equal((await event(m => m.method === 'turn/completed' && m.params.turn.id === interrupted.turn.id)).params.turn.status, 'interrupted');
  holdResponse = false;
  const history = async () => (await rpc('thread/turns/list', { threadId, limit: 20, itemsView: 'full' })).data
    .map(({ id, status, items }) => ({ id, status, items }));
  let saved = await history();
  assert.equal(saved.length, 3);
  assert.equal(saved.filter(t => t.status === 'completed').length, 2);
  assert.equal(saved.filter(t => t.status === 'interrupted').length, 1);
  for (const text of ['Create a retained conversation.', 'Exercise the local protocol fixture.', 'Retain this interrupted request.']) {
    assert.ok(JSON.stringify(saved).includes(text), `Missing saved message: ${text}`);
  }
  for (const wrapped of [true, false]) {
    await disconnect();
    ({ rpc, event } = connect(wrapped));
    await rpc('initialize', { clientInfo: { name: 'restart_fixture', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    assert.equal((await rpc('thread/resume', { threadId, cwd })).thread.id, threadId);
    assert.deepEqual(await history(), saved, wrapped ? 'Adapter restart changed saved history' : 'Normal native launch changed saved history');
    adapting = wrapped; requests.length = 0;
    const continued = await rpc('turn/start', { threadId, effort: 'low', input: [{ type: 'text', text: wrapped ? 'Continue after adapter restart.' : 'Continue after removing the wrapper.', text_elements: [] }] });
    assert.equal((await event(m => m.method === 'turn/completed' && m.params.turn.id === continued.turn.id)).params.turn.status, 'completed');
    assert.deepEqual(requests.map(r => r.reasoning.effort), wrapped ? ['low', 'high', 'low'] : ['low']);
    const next = await history();
    assert.equal(next.length, saved.length + 1);
    assert.deepEqual(next.filter(t => t.id !== continued.turn.id), saved);
    saved = next;
  }
  await disconnect();
});
