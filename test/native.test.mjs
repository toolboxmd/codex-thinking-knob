import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const binary = process.env.KNOB_NATIVE_BINARY;
const launcher = fileURLToPath(new URL('../bin/codex-thinking-knob.mjs', import.meta.url));

test('real App Server captures effort changes on subsequent provider requests', {
  skip: !binary && 'Set KNOB_NATIVE_BINARY to the Codex 0.153.4 executable',
  timeout: 45000,
}, async t => {
  assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8' }), /0\.153\.4\b/);
  const dir = await mkdtemp(join(tmpdir(), 'thinking-knob-native-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'codex');
  const cwd = join(dir, 'work');
  await mkdir(home); await mkdir(cwd);
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/responses') {
      res.writeHead(404); res.end(); return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const index = requests.length;
    const item = index <= 2
      ? { type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`,
          name: 'codex_thinking_knob_set_effort',
          arguments: JSON.stringify({ effort: index === 1 ? 'high' : 'low', reason: 'Deterministic protocol fixture' }) }
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
  t.after(() => { server.closeAllConnections(); server.close(); });
  await writeFile(join(home, 'config.toml'), `model = "gpt-6-astra"
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
  const child = spawn(process.execPath, [launcher, '--adaptive', '--', binary, '--enable', 'step_model_switching', 'app-server'], {
    cwd, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exit; clearTimeout(force);
  });
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
  await rpc('initialize', { clientInfo: { name: 'thinking_knob_fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const started = await rpc('thread/start', { model: 'gpt-6-astra', cwd, ephemeral: true });
  assert.equal(started.model, 'gpt-6-astra');
  const threadId = started.thread.id;
  const turn = await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'Exercise the local protocol fixture.', text_elements: [] }] });
  const completion = await event(m => m.method === 'turn/completed' && m.params.turn.id === turn.turn.id);
  assert.equal(completion.params.turn.status, 'completed', JSON.stringify(completion));
  assert.deepEqual(requests.map(r => r.reasoning?.effort), ['low', 'high', 'low'], JSON.stringify(requests.at(-1).input.filter(item => item.type === 'function_call_output')));
  assert.ok(JSON.stringify(requests[0]).includes('codex_thinking_knob_set_effort'), `Request keys: ${Object.keys(requests[0])}`);
  const outputs = requests[2].input.filter(item => item.type === 'function_call_output');
  assert.equal(outputs.length, 2);
  const outputText = item => typeof item.output === 'string' ? item.output : item.output.map(p => p.text ?? '').join('');
  for (const output of outputs) {
    const result = JSON.parse(outputText(output));
    assert.equal(result.status, 'applied');
    assert.equal(result.executionVerified, false);
  }
  const second = await rpc('turn/start', { threadId, input: [{ type: 'text', text: 'Check the unchanged next-turn default.', text_elements: [] }] });
  await event(m => m.method === 'turn/completed' && m.params.turn.id === second.turn.id);
  assert.equal(requests[3].reasoning.effort, 'low');
  t.diagnostic(`Codex 0.153.4 provider requests: ${requests.map(r => r.reasoning.effort).join(' -> ')}. Local fixture only; no Astra inference or savings measurement.`);
});
