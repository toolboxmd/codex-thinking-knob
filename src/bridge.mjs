export const TOOL_NAME = 'codex_thinking_knob_set_effort';
export const EFFORTS = ['low', 'medium', 'high', 'max'];
export const TOOL = {
  type: 'function', name: TOOL_NAME,
  description: 'Set reasoning effort for subsequent captures in this active Astra turn. Use low for routine work; choose medium, high, or max only for material uncertainty and lower effort when work becomes routine. Obey user-fixed effort. Applied means accepted for subsequent captures, not verified inference.',
  inputSchema: { type: 'object', properties: { effort: { type: 'string', enum: EFFORTS }, reason: { type: 'string', maxLength: 500 } }, required: ['effort'], additionalProperties: false },
};
const hasId = m => Object.hasOwn(m, 'id');
const astra = model => model === 'gpt-6-astra';
const collision = tools => tools.some(t => t?.name === TOOL_NAME || t?.tools?.some(s => s?.name === TOOL_NAME));

/** Owns one protocol connection. Callbacks must synchronously enqueue messages in order. */
export function createBridge({ adaptive = false, timeoutMs = 10_000, toChild, toClient }) {
  let sequence = 0;
  let closed = false;
  let experimental = false;
  const pending = new Map();
  const threads = new Map();
  const id = () => `thinking-knob:${++sequence}`;
  const reject = (m, message) => toClient({ id: m.id, error: { code: -32602, message } });
  const toolResult = (request, success, result) => toChild({ id: request.id, result: {
    contentItems: [{ type: 'inputText', text: JSON.stringify(result) }], success,
  } });
  const invalidate = t => { if (t) { t.active = null; t.pendingTurn = null; t.blocked = true; } };

  function client(message) {
    if (closed) return;
    if (!adaptive) return toChild(message);
    let m = message;
    const p = m.params ?? {};
    const t = threads.get(p.threadId);
    let context;
    if (m.method === 'initialize' && hasId(m)) {
      if (p.capabilities?.experimentalApi === false) return reject(m, '--adaptive requires experimentalApi; explicit false is incompatible');
      m = { ...m, params: { ...p, capabilities: { ...p.capabilities, experimentalApi: true } } };
      context = { kind: 'initialize' };
    } else if (m.method === 'thread/start' && hasId(m) && astra(p.model)) {
      if (!experimental) return reject(m, 'Adaptive Astra thread/start requires successful experimental initialization');
      if (p.dynamicTools != null && !Array.isArray(p.dynamicTools)) return reject(m, 'dynamicTools must be an array');
      if (collision(p.dynamicTools ?? [])) return reject(m, `Dynamic tool collision: ${TOOL_NAME}`);
      m = { ...m, params: { ...p, dynamicTools: [...(p.dynamicTools ?? []), TOOL] } };
      context = { kind: 'thread', blocked: p.config?.model_reasoning_effort != null || p.config?.collaboration_mode != null };
    } else if (m.method === 'turn/start' && hasId(m) && t) {
      // Native model/effort overrides persist as defaults. Never silently undo them.
      if (p.model != null) t.model = p.model;
      if (p.effort != null || p.collaborationMode != null) t.blocked = true;
      t.active = null;
      t.pendingTurn = { allowed: !t.blocked && astra(t.model), token: id() };
      context = { kind: 'turn', threadId: p.threadId, token: t.pendingTurn.token };
    } else if (m.method === 'turn/settings/update' && t && (p.effort != null || p.model != null)) {
      // An explicit client setting wins immediately, even while its reply is pending.
      invalidate(t);
      if (p.model != null) t.model = p.model;
    } else if (m.method === 'thread/resume' || m.method === 'thread/fork' || m.method === 'thread/settings/update' || m.method === 'thread/unload' || m.method === 'thread/archive') {
      // Persisted tools alone cannot prove ownership; resuming is deliberately unsupported.
      invalidate(t);
    } else if (m.method === 'turn/interrupt') {
      if (t && (!p.turnId || t.active?.id === p.turnId)) invalidate(t);
    }
    if (m.method && hasId(m)) {
      const ownedId = id();
      pending.set(ownedId, { kind: 'client', originalId: m.id, context });
      toChild({ ...m, id: ownedId });
    } else {
      // JSON-RPC cancellation names a client request, not a server callback.
      if ((m.method === '$/cancelRequest' || m.method === 'notifications/cancelled') && p.id !== undefined) {
        for (const [mapped, entry] of pending) if (entry.kind === 'client' && entry.originalId === p.id) {
          m = { ...m, params: { ...p, id: mapped } }; break;
        }
      }
      toChild(m);
    }
  }

  function server(m) {
    if (closed) return;
    if (!adaptive) return toClient(m);
    const p = m.params ?? {};
    if (!m.method && hasId(m)) {
      const entry = pending.get(m.id);
      if (!entry) return; // Late owned replies must not leak into the client ID space.
      pending.delete(m.id);
      if (entry.kind === 'tool') {
        clearTimeout(entry.timer);
        const applied = !m.error && m.result?.status === 'applied';
        toolResult(entry.request, applied, applied
          ? { status: 'applied', effort: entry.effort, executionVerified: false, detail: 'Published for subsequent captures; later inference is not guaranteed.' }
          : { status: m.error ? 'nativeError' : (m.result?.status ?? 'invalidNativeResponse'), ...(m.error ? { error: m.error } : {}) });
      } else {
        const c = entry.context;
        if (!m.error && c?.kind === 'initialize') experimental = true;
        if (!m.error && c?.kind === 'thread' && typeof m.result?.thread?.id === 'string') {
          threads.set(m.result.thread.id, { model: m.result.model, defaultEffort: m.result.reasoningEffort, blocked: c.blocked || !astra(m.result.model), active: null, pendingTurn: null });
        }
        if (c?.kind === 'turn') {
          const t = threads.get(c.threadId);
          if (t?.pendingTurn?.token === c.token) {
            if (m.error) { t.active = null; t.pendingTurn = null; }
            else if (typeof m.result?.turn?.id === 'string') {
              t.active = { id: m.result.turn.id, allowed: t.pendingTurn.allowed };
              t.pendingTurn = null;
            }
          }
        }
        toClient({ ...m, id: entry.originalId });
      }
      return;
    }
    const t = threads.get(p.threadId);
    if (m.method === 'turn/started' && t?.pendingTurn && typeof p.turn?.id === 'string') {
      t.active = { id: p.turn.id, allowed: t.pendingTurn.allowed };
      // Retain pending context so a matching start reply does not replace newer state.
    }
    if (m.method === 'turn/completed' && t?.active?.id === p.turn?.id) { t.active = null; t.pendingTurn = null; }
    if (m.method === 'model/rerouted' && t) { invalidate(t); t.model = p.toModel; }
    if (m.method === 'thread/settings/updated' && t) {
      const settings = p.threadSettings;
      if (!settings || settings.model !== t.model || settings.effort !== t.defaultEffort) invalidate(t);
      if (settings) { t.model = settings.model; t.defaultEffort = settings.effort; }
    }
    if (['thread/closed', 'thread/deleted', 'thread/archived'].includes(m.method)) threads.delete(p.threadId);
    if (m.method === 'item/tool/call' && hasId(m) && p.tool === TOOL_NAME && p.namespace == null && t) {
      const a = p.arguments;
      if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(key => !['effort', 'reason'].includes(key)) || !EFFORTS.includes(a.effort) || (Object.hasOwn(a, 'reason') && (typeof a.reason !== 'string' || a.reason.length > 500))) {
        toolResult(m, false, { status: 'invalidArguments', detail: 'Expected effort: low, medium, high, or max, and optional reason up to 500 characters.' }); return;
      }
      if (!astra(t.model) || t.blocked || !t.active?.allowed || t.active.id !== p.turnId) {
        toolResult(m, false, { status: 'targetUnavailable', detail: 'No owned, adaptive, active Astra turn matches this call.' }); return;
      }
      const ownedId = id();
      const timer = setTimeout(() => {
        if (!pending.delete(ownedId)) return;
        toolResult(m, false, { status: 'timeout', detail: 'Native update outcome is unknown; no execution claim is made.' });
      }, timeoutMs);
      pending.set(ownedId, { kind: 'tool', request: m, effort: a.effort, timer });
      toChild({ id: ownedId, method: 'turn/settings/update', params: { threadId: p.threadId, turnId: p.turnId, effort: a.effort } });
      return;
    }
    toClient(m);
  }
  function close() {
    closed = true;
    for (const entry of pending.values()) if (entry.timer) clearTimeout(entry.timer);
    pending.clear(); threads.clear();
  }
  return { client, server, close };
}
