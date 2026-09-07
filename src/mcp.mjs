import net from 'node:net';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const MAX_BYTES = 64 * 1024;
export const TOOL_NAME = 'set_effort';
const efforts = ['low', 'medium', 'high', 'max'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20]/.test(value);
export const TOOL = {
  name: TOOL_NAME,
  description: 'Request Astra reasoning effort for subsequent model requests in this active turn. An applied result confirms acceptance, not verified model execution. Use low for routine implementation; medium for local uncertainty; high or max when difficulty warrants it, then lower it after resolution. Honor user-fixed settings. Requires an activated Thinking Knob desktop adapter.',
  inputSchema: { type: 'object', properties: { effort: { type: 'string', enum: efforts }, reason: { type: 'string', maxLength: 500 } }, required: ['effort'], additionalProperties: false },
};

export function requestFromCall(params, token) {
  if (!object(params) || params.name !== TOOL_NAME) throw new Error('Unknown tool');
  const args = params.arguments;
  if (!object(args) || Object.keys(args).some(key => !['effort', 'reason'].includes(key)) || !efforts.includes(args.effort) || (args.reason !== undefined && (typeof args.reason !== 'string' || args.reason.length > 500))) throw new Error('Invalid effort arguments');
  const meta = params._meta;
  const turn = meta?.['x-codex-turn-metadata'];
  if (!object(meta) || !object(turn) || !identity(meta.threadId) || !identity(turn.thread_id) || !identity(turn.turn_id) || meta.threadId !== turn.thread_id) throw new Error('Missing or inconsistent trusted Codex call identity');
  return { token, threadId: meta.threadId, turnId: turn.turn_id, effort: args.effort, ...(args.reason === undefined ? {} : { reason: args.reason }) };
}

export function sendControl(request, { socketPath, timeoutMs = 12_000 } = {}) {
  if (!socketPath || !request.token) return Promise.reject(new Error('Thinking Knob desktop adapter is not activated'));
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const socket = net.createConnection({ path: socketPath });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Control request timed out; acceptance is unknown')), timeoutMs);
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('error', () => finish(new Error('Thinking Knob control connection failed')));
    socket.on('end', () => finish(new Error('Thinking Knob control connection ended without a result')));
    socket.on('data', chunk => {
      if (bytes.length + chunk.length > MAX_BYTES) return finish(new Error('Oversized control response'));
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      try {
        const result = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
        if (!object(result) || typeof result.status !== 'string' || result.executionVerified !== false || (result.status === 'applied' && result.effort !== request.effort)) throw new Error();
        finish(null, result);
      } catch { finish(new Error('Invalid control response')); }
    });
  });
}

export function serveMcp({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  let pending = Buffer.alloc(0);
  let closed = false;
  const write = message => { if (!closed) output.write(`${JSON.stringify(message)}\n`); };
  const error = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  async function handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { error(null, -32700, 'Parse error'); return; }
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (message.id !== undefined && typeof message.id !== 'string' && !Number.isInteger(message.id))) { error(null, -32600, 'Invalid request'); return; }
    if (message.id === undefined) return;
    const respond = result => write({ jsonrpc: '2.0', id: message.id, result });
    switch (message.method) {
      case 'initialize': {
        const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
        respond({ protocolVersion: supported.includes(message.params?.protocolVersion) ? message.params.protocolVersion : supported[0], capabilities: { tools: {} }, serverInfo: { name: 'codex-thinking-knob', version } });
        break;
      }
      case 'ping': respond({}); break;
      case 'tools/list': respond({ tools: [TOOL] }); break;
      case 'tools/call': {
        try {
          const request = requestFromCall(message.params, env.KNOB_CONTROL_TOKEN);
          const result = await sendControl(request, { socketPath: env.KNOB_CONTROL_SOCKET });
          respond({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.status !== 'applied' });
        } catch (cause) {
          respond({ content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', message: cause.message, executionVerified: false }) }], isError: true });
        }
        break;
      }
      default: error(message.id, -32601, 'Method not found');
    }
  }
  input.on('data', chunk => {
    if (closed) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index] !== 10) continue;
      const fragment = buffer.subarray(start, index);
      if (pending.length + fragment.length > MAX_BYTES) { error(null, -32600, 'Oversized request'); closed = true; input.destroy(); return; }
      const line = Buffer.concat([pending, fragment]).toString('utf8');
      pending = Buffer.alloc(0);
      if (line.trim()) void handle(line);
      start = index + 1;
    }
    pending = Buffer.concat([pending, buffer.subarray(start)]);
    if (pending.length > MAX_BYTES) { error(null, -32600, 'Oversized request'); closed = true; input.destroy(); }
  });
}
