#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessSync, constants } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node bin/launch-desktop.mjs [--thread THREAD_ID] [--dry-run]\nQuit ChatGPT/Codex first. Starts the normal app with adaptive effort enabled; --thread limits control to one existing task. Quit and launch the app normally to remove activation.');
  process.exit(0);
}
let thread;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') continue;
  if (args[i] === '--thread' && /^[0-9a-f-]{36}$/.test(args[i + 1] ?? '')) { thread = args[++i]; continue; }
  throw new Error(`Invalid launcher argument: ${args[i]}`);
}
if (process.platform !== 'darwin') throw new Error('Desktop launch is currently verified only on macOS');
const application = '/Applications/ChatGPT.app';
const native = `${application}/Contents/Resources/codex`;
const bundledNode = `${application}/Contents/Resources/cua_node/bin/node`;
const adapter = fileURLToPath(new URL('./thinking-knob-desktop', import.meta.url));
accessSync(native, constants.X_OK); accessSync(bundledNode, constants.X_OK); accessSync(adapter, constants.X_OK);
if (process.env.CODEX_CLI_PATH && process.env.CODEX_CLI_PATH !== native && process.env.CODEX_CLI_PATH !== adapter) {
  throw new Error('An existing CODEX_CLI_PATH override must be reconciled before activation');
}
const command = ['/usr/bin/open', '--env', `CODEX_CLI_PATH=${adapter}`,
  '--env', `KNOB_ADAPTIVE_THREADS=${thread ?? ''}`, application];
const running = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' }).split('\n')
  .some(line => line.trim().startsWith(`${application}/Contents/MacOS/`));
if (args.includes('--dry-run')) console.log(JSON.stringify({ command, appRunning: running, requiresQuit: running, thread: thread ?? 'all eligible Astra tasks', globalConfigChanges: false }, null, 2));
else {
  if (running) throw new Error('Quit ChatGPT/Codex first, then run this command from Terminal. The existing app connection cannot be replaced by open.');
  execFileSync(command[0], command.slice(1));
  console.log('Launch requested. Resume the same task and verify the Thinking Knob tool before claiming activation.');
}
