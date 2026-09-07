import { EFFORTS } from './bridge.mjs';

const hasId = m => Object.hasOwn(m, 'id');
const astra = model => model === 'gpt-6-astra';
const result = (status, extra = {}) => ({ status, executionVerified: false, ...extra });

/** One desktop connection, including resumed tasks. Never inject user messages. */
export function createDesktopBridge({ toChild, toClient, timeoutMs = 10_000, allowedThreads = null }) {
  let sequence = 0, initialized = false, closed = false;
  const pending = new Map(), threads = new Map();
  const nextId = () => `thinking-knob-desktop:${++sequence}`;
  const invalidate = t => { if (t) { t.active = null; t.start = null; } };

  function client(message) {
    if (closed) return;
    let m = message;
    const p = m.params ?? {}, t = threads.get(p.threadId);
    let context;
    if (m.method === 'initialize' && hasId(m)) {
      if (p.capabilities?.experimentalApi === false) {
        toClient({ id: m.id, error: { code: -32602, message: 'Thinking Knob desktop activation requires experimentalApi' } });
        return;
      }
      m = { ...m, params: { ...p, capabilities: { ...p.capabilities, experimentalApi: true } } };
      context = { kind: 'initialize' };
    } else if (['thread/start', 'thread/resume', 'thread/fork'].includes(m.method) && hasId(m)) {
      invalidate(t);
      context = { kind: 'thread', previous: t };
    } else if (m.method === 'turn/start' && t && hasId(m)) {
      invalidate(t);
      // Desktop sends its initial UI effort on every turn. Activation opts into
      // adaptation after that initial capture; explicit settings updates lock it.
      t.model = p.collaborationMode?.settings?.model ?? p.model ?? t.model;
      t.start = nextId();
      context = { kind: 'turn', threadId: p.threadId, token: t.start };
    } else if (['turn/settings/update', 'thread/settings/update'].includes(m.method) && t) {
      if (p.effort != null || p.model != null || p.collaborationMode != null) {
        t.locked = true;
        if (p.model != null) t.model = p.model;
      }
    } else if (['turn/interrupt', 'thread/unload', 'thread/archive'].includes(m.method)) {
      invalidate(t);
    }
    if (m.method && hasId(m)) {
      const id = nextId();
      pending.set(id, { kind: 'client', originalId: m.id, context });
      toChild({ ...m, id });
    } else {
      if (['$/cancelRequest', 'notifications/cancelled'].includes(m.method) && p.id !== undefined) {
        for (const [id, entry] of pending) if (entry.kind === 'client' && entry.originalId === p.id) {
          m = { ...m, params: { ...p, id } }; break;
        }
      }
      toChild(m);
    }
  }

  function server(m) {
    if (closed) return;
    if (!m.method && hasId(m)) {
      const entry = pending.get(m.id);
      if (!entry) return;
      pending.delete(m.id);
      if (entry.kind === 'control') {
        clearTimeout(entry.timer);
        entry.resolve(m.error ? result('nativeError', { error: m.error })
          : result(m.result?.status ?? 'invalidNativeResponse', { effort: entry.effort }));
        return;
      }
      const c = entry.context;
      if (!m.error && c?.kind === 'initialize') initialized = true;
      if (!m.error && c?.kind === 'thread' && typeof m.result?.thread?.id === 'string') {
        const thread = m.result.thread;
        const active = thread.turns?.findLast(turn => turn.status === 'inProgress');
        threads.set(thread.id, { model: m.result.model, locked: c.previous?.locked ?? false,
          active: active?.id ?? null, start: null });
      }
      if (c?.kind === 'turn') {
        const t = threads.get(c.threadId);
        if (t?.start === c.token) {
          t.start = null;
          t.active = m.error ? null : (m.result?.turn?.id ?? null);
        }
      }
      toClient({ ...m, id: entry.originalId });
      return;
    }
    const p = m.params ?? {}, t = threads.get(p.threadId);
    if (m.method === 'turn/started' && t?.start && typeof p.turn?.id === 'string') t.active = p.turn.id;
    if (m.method === 'turn/completed' && t?.active === p.turn?.id) invalidate(t);
    if (m.method === 'model/rerouted' && t) { t.model = p.toModel; t.locked = true; }
    if (m.method === 'thread/settings/updated' && t && p.threadSettings?.model !== t.model) {
      t.model = p.threadSettings?.model; t.locked = true;
    }
    if (['thread/closed', 'thread/deleted', 'thread/archived'].includes(m.method)) threads.delete(p.threadId);
    toClient(m);
  }

  function setEffort({ threadId, turnId, effort, reason }) {
    if (!EFFORTS.includes(effort) || (reason !== undefined && (typeof reason !== 'string' || reason.length > 500))) return Promise.resolve(result('invalidArguments'));
    const t = threads.get(threadId);
    if (closed || !initialized || !t || !astra(t.model) || t.active !== turnId || !turnId
      || (allowedThreads && !allowedThreads.has(threadId))) return Promise.resolve(result('targetUnavailable'));
    if (t.locked) return Promise.resolve(result('fixedPolicy', { detail: 'An explicit desktop settings change takes precedence until the adapter restarts.' }));
    return new Promise(resolve => {
      const id = nextId();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(result('timeout', { detail: 'Native outcome unknown.' }));
      }, timeoutMs);
      pending.set(id, { kind: 'control', resolve, timer, effort });
      toChild({ id, method: 'turn/settings/update', params: { threadId, turnId, effort } });
    });
  }

  function close() {
    closed = true;
    for (const entry of pending.values()) if (entry.kind === 'control') {
      clearTimeout(entry.timer); entry.resolve(result('disconnected'));
    }
    pending.clear(); threads.clear();
  }
  return { client, server, setEffort, close };
}
