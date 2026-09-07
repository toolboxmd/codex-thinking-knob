#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createDesktopBridge } from '../src/desktop-bridge.mjs';
import { createControl } from '../src/control.mjs';

// Resolve the app's bundled binary every launch so app updates cannot leave a
// stale independently installed CLI underneath the desktop.
const binary = process.env.KNOB_NATIVE_BINARY ?? '/Applications/ChatGPT.app/Contents/Resources/codex';
accessSync(binary, constants.X_OK);
if (realpathSync(binary) === realpathSync(process.argv[1])) throw new Error('Recursive native binary override');
const args = process.argv.slice(2);
const index = args.indexOf('app-server');
const commandAfter = index < 0 ? null : args[index + 1];
const isServer = index >= 0 && (!commandAfter || commandAfter.startsWith('-')) && !args.some(a => ['--help', '-h', '--version'].includes(a));
if (!isServer) {
  // execve keeps signed CLI ancestry intact for native helper commands.
  if (process.execve) process.execve(binary, [binary, ...args], process.env);
  else {
    const child = spawn(binary, args, { stdio: 'inherit' });
    child.on('error', () => { process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  }
} else {
  if (args.some(a => a === '--listen' || a.startsWith('--listen='))) throw new Error('Desktop activation requires its stdio transport');
  let child, stopping = false, force;
  const inputs = [];
  const bridge = createDesktopBridge({
    allowedThreads: process.env.KNOB_ADAPTIVE_THREADS ? new Set(process.env.KNOB_ADAPTIVE_THREADS.split(',')) : null,
    toChild: m => send(child.stdin, m), toClient: m => send(process.stdout, m),
  });
  const control = await createControl(bridge.setEffort);
  child = spawn(binary, [...args, '--enable', 'step_model_switching'], {
    env: { ...process.env, KNOB_CONTROL_SOCKET: control.socket, KNOB_CONTROL_TOKEN: control.token,
      CODEX_CLI_PATH: binary }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  function send(stream, message) {
    if (stopping || stream.destroyed) return;
    if (stream.writableLength > 8 * 1024 * 1024) { void stop(1); return; }
    stream.write(JSON.stringify(message) + '\n');
  }
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true; process.exitCode = code; bridge.close();
    for (const input of inputs) input.close();
    process.stdin.pause(); child.stdin.destroy(); child.kill('SIGTERM');
    force = setTimeout(() => child.kill('SIGKILL'), 1000); force.unref();
    await control.close();
  }
  function read(stream, receive) {
    let bytes = 0;
    stream.on('data', chunk => {
      bytes += chunk.length;
      const newline = chunk.lastIndexOf(10);
      if (bytes > 8 * 1024 * 1024) void stop(1);
      if (newline >= 0) bytes = chunk.length - newline - 1;
    });
    const input = createInterface({ input: stream, crlfDelay: Infinity }); inputs.push(input);
    input.on('line', line => {
      if (stopping || !line.trim()) return;
      try { const m = JSON.parse(line); if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(); receive(m); }
      catch { process.stderr.write('Invalid desktop App Server protocol\n'); void stop(1); }
    });
    return input;
  }
  read(process.stdin, bridge.client).on('close', () => void stop());
  read(child.stdout, bridge.server);
  child.once('error', () => void stop(1));
  child.once('exit', (code, signal) => { clearTimeout(force); void stop(code ?? (signal ? 1 : 0)); });
  for (const stream of [child.stdin, child.stdout, process.stdin, process.stdout]) stream.on('error', () => void stop(1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop(signal === 'SIGINT' ? 130 : 143));
}
