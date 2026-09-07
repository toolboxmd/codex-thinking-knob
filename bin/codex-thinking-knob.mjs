#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createBridge } from '../src/bridge.mjs';

const argv = process.argv.slice(2);
let adaptive = false;
let timeoutMs = 10_000;
let command = ['codex', 'app-server'];
let customCommand = false;
const usage = 'Usage: codex-thinking-knob [--adaptive] [--timeout-ms N] [-- child-command args...]\nDefault: codex app-server. Adaptive mode requires the experimental App Server API.\n';
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') { process.stdout.write(usage); process.exit(0); }
  if (arg === '--version') { process.stdout.write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version + '\n'); process.exit(0); }
  if (arg === '--adaptive') adaptive = true;
  else if (arg === '--timeout-ms') {
    const value = argv[++i];
    timeoutMs = Number(value);
    if (!/^\d+$/.test(value ?? '') || timeoutMs < 1 || timeoutMs > 120_000) { process.stderr.write('--timeout-ms must be an integer from 1 to 120000\n'); process.exit(2); }
  } else if (arg === '--') {
    customCommand = true;
    command = argv.slice(i + 1);
    if (!command.length) { process.stderr.write('Missing child command after --\n'); process.exit(2); }
    break;
  } else { process.stderr.write(`Unknown option: ${arg}\n${usage}`); process.exit(2); }
}

if (adaptive && !customCommand) command = ['codex', '--enable', 'step_model_switching', 'app-server'];

const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
let stopping = false;
let shutdownTimer;
const lines = [];
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  bridge.close();
  for (const input of lines) input.close();
  process.stdin.pause();
  child.stdin.destroy();
  child.kill('SIGTERM');
  shutdownTimer = setTimeout(() => { child.kill('SIGKILL'); process.stdout.destroy(); }, 1000);
  shutdownTimer.unref();
}
function send(stream, source, message) {
  if (stopping || stream.destroyed) return;
  if (stream.writableLength > 8 * 1024 * 1024) {
    process.stderr.write('Protocol output exceeded the 8 MiB backpressure limit; closing bridge\n');
    stop(1); return;
  }
  if (!stream.write(JSON.stringify(message) + '\n')) {
    source.pause();
    stream.once('drain', () => { if (!stopping) source.resume(); });
  }
}
const bridge = createBridge({ adaptive, timeoutMs,
  toChild: m => send(child.stdin, process.stdin, m),
  toClient: m => send(process.stdout, child.stdout, m),
});
function read(stream, receive) {
  const input = createInterface({ input: stream, crlfDelay: Infinity });
  lines.push(input);
  input.on('line', line => {
    if (stopping || !line.trim()) return;
    try { const m = JSON.parse(line); if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(); receive(m); }
    catch { process.stderr.write('Invalid App Server JSON line; closing bridge\n'); stop(1); }
  });
  return input;
}
read(process.stdin, bridge.client).on('close', () => stop());
read(child.stdout, bridge.server);
child.on('error', error => { process.exitCode = 1; process.stderr.write(`Unable to start child: ${error.message}\n`); stop(1); });
child.on('exit', (code, signal) => { if (!stopping) stop(code ?? (signal ? 1 : 0)); });
for (const stream of [child.stdin, child.stdout, process.stdin, process.stdout]) stream.on('error', () => stop(1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal === 'SIGINT' ? 130 : 143));
