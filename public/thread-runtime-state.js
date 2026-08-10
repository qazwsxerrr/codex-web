const ACTIVE_STATUSES = new Set([
  "active",
  "inprogress",
  "in_progress",
  "running",
  "working",
  "waiting",
  "waitingforinput",
  "waiting_for_input",
]);

function text(value) {
  return String(value ?? "").trim();
}

function statusText(value) {
  if (!value) return "notLoaded";
  if (typeof value === "string") return value;
  return value.status || value.type || value.state || "unknown";
}

function isActiveStatus(value) {
  const normalized = statusText(value).toLowerCase().replace(/[-\s]/g, "_");
  return ACTIVE_STATUSES.has(normalized) || normalized === "waiting_for_input";
}

function runtimeDefaults(threadId) {
  return {
    threadId,
    activeTurnId: null,
    status: "notLoaded",
    running: false,
    accessMode: null,
    snapshotAt: null,
    snapshotReason: null,
    writerConflict: null,
    unread: false,
    unreadCount: 0,
    pendingServerRequests: [],
    pendingTurnSettings: {},
    latestThread: null,
    latestSnapshot: null,
    lastEventAt: null,
    error: null,
  };
}

export function normalizeThreadId(value) {
  const id = text(value);
  return id || null;
}

export function canBeginThreadSelection(selectionPending = false) {
  return !Boolean(selectionPending);
}

export function createThreadRuntime(threadId, source = {}) {
  const id = normalizeThreadId(threadId || source.threadId);
  if (!id) return null;
  const runtime = { ...runtimeDefaults(id) };
  const patch = source.runtime && typeof source.runtime === "object" ? source.runtime : source;
  const status = statusText(patch.status || patch.threadStatus || patch.latestThread?.status);
  const activeTurnId = patch.activeTurnId || patch.turnId || patch.latestTurn?.id || null;
  Object.assign(runtime, patch, {
    threadId: id,
    status,
    activeTurnId,
    running: patch.running !== undefined
      ? Boolean(patch.running)
      : Boolean(activeTurnId) || isActiveStatus(status),
    unread: Boolean(patch.unread),
    unreadCount: Math.max(0, Number(patch.unreadCount || 0) || 0),
    pendingServerRequests: Array.isArray(patch.pendingServerRequests || patch.pendingRequests || patch.pendingApprovals)
      ? (patch.pendingServerRequests || patch.pendingRequests || patch.pendingApprovals).slice()
      : [],
    pendingTurnSettings: patch.pendingTurnSettings && typeof patch.pendingTurnSettings === "object"
      ? { ...patch.pendingTurnSettings }
      : {},
  });
  return runtime;
}

export function createThreadRuntimeStore({ selectedThreadId = null, runtimes = [] } = {}) {
  const store = {
    selectedThreadId: normalizeThreadId(selectedThreadId),
    runtimes: new Map(),
  };
  if (runtimes instanceof Map) {
    for (const [id, runtime] of runtimes) {
      const normalized = createThreadRuntime(id, runtime);
      if (normalized) store.runtimes.set(normalized.threadId, normalized);
    }
  } else if (Array.isArray(runtimes)) {
    for (const runtime of runtimes) {
      const normalized = createThreadRuntime(runtime?.threadId, runtime);
      if (normalized) store.runtimes.set(normalized.threadId, normalized);
    }
  }
  return store;
}

export function getThreadRuntime(store, threadId, create = true) {
  const id = normalizeThreadId(threadId);
  if (!store || !id) return null;
  const existing = store.runtimes.get(id);
  if (existing || !create) return existing || null;
  const runtime = createThreadRuntime(id);
  store.runtimes.set(id, runtime);
  return runtime;
}

export function updateThreadRuntime(store, threadId, patch = {}, { markUnread = true } = {}) {
  const id = normalizeThreadId(threadId || patch.threadId);
  if (!store || !id) return null;
  const previous = getThreadRuntime(store, id);
  const source = patch.runtime && typeof patch.runtime === "object" ? patch.runtime : patch;
  const merged = { ...previous, ...source };
  if (source.running === undefined && (source.status !== undefined || source.threadStatus !== undefined || source.activeTurnId !== undefined || source.turnId !== undefined)) {
    const nextStatus = statusText(source.status || source.threadStatus || merged.status);
    merged.running = Boolean(source.activeTurnId || source.turnId) || isActiveStatus(nextStatus);
  }
  const next = createThreadRuntime(id, merged);
  const changed = source.status !== undefined
    || source.running !== undefined
    || source.activeTurnId !== undefined
    || source.latestThread !== undefined
    || source.latestSnapshot !== undefined
    || source.latestSettings !== undefined
    || source.pendingTurnSettings !== undefined
    || source.pendingServerRequests !== undefined
    || source.pendingRequests !== undefined
    || source.pendingApprovals !== undefined
    || source.name !== undefined
    || source.error !== undefined;
  if (markUnread && changed && store.selectedThreadId !== id && source.unread === undefined) {
    next.unread = true;
    next.unreadCount = Math.max(1, previous.unreadCount + 1);
  }
  next.lastEventAt = source.lastEventAt || new Date().toISOString();
  store.runtimes.set(id, next);
  return next;
}

export function applyRuntimeSnapshot(store, payload = {}) {
  if (!store) return [];
  if (payload.deleted) {
    const id = normalizeThreadId(payload.threadId || payload.runtime?.threadId);
    if (id) store.runtimes.delete(id);
    if (store.selectedThreadId === id) store.selectedThreadId = null;
    return [];
  }
  const entries = payload.runtimes || payload.threadRuntimes || payload.runtimeSnapshot;
  if (entries && typeof entries === "object" && !Array.isArray(entries)
    && (entries.threadId || entries.runtime || entries.status || entries.activeTurnId || entries.running !== undefined)) {
    const id = normalizeThreadId(entries.threadId || entries.runtime?.threadId || payload.threadId);
    return id ? [updateThreadRuntime(store, id, entries.runtime || entries, { markUnread: false })] : [];
  }
  if (entries instanceof Map || Array.isArray(entries)) {
    const values = entries instanceof Map ? [...entries.values()] : entries;
    return values.map((runtime) => updateThreadRuntime(store, runtime?.threadId, runtime, { markUnread: false })).filter(Boolean);
  }
  if (entries && typeof entries === "object") {
    return Object.entries(entries)
      .map(([id, runtime]) => updateThreadRuntime(store, id, runtime, { markUnread: false }))
      .filter(Boolean);
  }
  const id = normalizeThreadId(payload.threadId || payload.runtime?.threadId || payload.thread?.id);
  return id ? [updateThreadRuntime(store, id, payload.runtime || payload, { markUnread: false })] : [];
}

export function selectThreadRuntime(store, threadId, { markRead = true } = {}) {
  if (!store) return null;
  const id = normalizeThreadId(threadId);
  store.selectedThreadId = id;
  if (!id) return null;
  const runtime = getThreadRuntime(store, id);
  if (markRead) {
    runtime.unread = false;
    runtime.unreadCount = 0;
  }
  return runtime;
}

export function markThreadRuntimeRead(store, threadId) {
  const runtime = getThreadRuntime(store, threadId, false);
  if (!runtime) return null;
  runtime.unread = false;
  runtime.unreadCount = 0;
  return runtime;
}

export function isThreadRuntimeBusy(runtime) {
  const value = runtime || {};
  return Boolean(value.running || value.activeTurnId) || isActiveStatus(value.status);
}

export function runtimeIndicator(runtime) {
  const value = runtime || {};
  const running = isThreadRuntimeBusy(value);
  const status = statusText(value.status || (running ? "active" : "idle"));
  return {
    running,
    status,
    unread: Boolean(value.unread || value.unreadCount),
    unreadCount: Math.max(0, Number(value.unreadCount || 0) || 0),
    label: running ? "Running" : status,
  };
}

export function runtimeThreadIdFromNotification(message = {}) {
  return normalizeThreadId(
    message.threadId
      || message.params?.threadId
      || message.params?.thread?.id
      || message.runtime?.threadId
      || message.payload?.threadId,
  );
}

export function selectedThreadStorageKey(prefix = "codexMathSelectedThread") {
  return `${prefix}:selectedThreadId`;
}

export function readSelectedThread(storage, fallback = null, prefix) {
  const key = selectedThreadStorageKey(prefix);
  try {
    return normalizeThreadId(storage?.getItem(key)) || normalizeThreadId(fallback);
  } catch {
    return normalizeThreadId(fallback);
  }
}

export function writeSelectedThread(storage, threadId, prefix) {
  const key = selectedThreadStorageKey(prefix);
  const id = normalizeThreadId(threadId);
  try {
    if (id) storage?.setItem(key, id);
    else storage?.removeItem(key);
  } catch {
    // sessionStorage can be unavailable in privacy mode.
  }
  return id;
}

export function reconnectDelay(attempt, { base = 250, max = 8000 } = {}) {
  const count = Math.max(0, Number(attempt) || 0);
  return Math.min(max, base * (2 ** Math.min(count, 8)));
}
