const QUEUE_MODES = new Set(["steer", "followUp"]);
const QUEUE_STATUSES = new Set(["pending", "sending", "accepted", "failed"]);
let generatedId = 0;

function textValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function displayTextFor(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return textValue(input);
  return input.map((part) => {
    if (!part || typeof part !== "object") return "";
    if (part.type === "text") return textValue(part.text);
    if (part.type === "mention") return `@${textValue(part.name || part.path)}`;
    if (part.type === "image") return "[Image]";
    if (part.type === "localImage") return `[Image: ${textValue(part.path)}]`;
    return "";
  }).filter(Boolean).join("\n");
}

function nextEntryId(createdAt) {
  generatedId += 1;
  return `queue-${createdAt}-${generatedId}`;
}

export function createQueueEntry(value = {}, defaults = {}) {
  const source = typeof value === "object" && value !== null ? value : { input: value };
  const createdAt = source.createdAt ?? defaults.createdAt ?? Date.now();
  const input = source.input ?? source.text ?? "";
  const mode = QUEUE_MODES.has(source.mode) ? source.mode : QUEUE_MODES.has(defaults.mode) ? defaults.mode : "followUp";
  const status = QUEUE_STATUSES.has(source.status) ? source.status : "pending";
  return {
    id: textValue(source.id || defaults.id || nextEntryId(createdAt)),
    threadId: textValue(source.threadId ?? defaults.threadId),
    input,
    displayText: textValue(source.displayText ?? displayTextFor(input)),
    mode,
    status,
    attempts: Number.isFinite(Number(source.attempts)) ? Math.max(0, Number(source.attempts)) : 0,
    error: source.error ?? null,
    createdAt,
  };
}

export function createQueueState(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((entry) => createQueueEntry(entry));
}

function actionType(action) {
  return textValue(action?.type).replace(/[\s_-]/g, "").toLowerCase();
}

function entryId(action) {
  return textValue(action?.id ?? action?.entryId ?? action?.entry?.id);
}

function matchingThread(entry, threadId) {
  return !threadId || entry.threadId === textValue(threadId);
}

export function queueReducer(state = [], action = {}) {
  const current = Array.isArray(state) ? state : [];
  const type = actionType(action);
  if (type === "enqueue" || type === "add") {
    const entry = createQueueEntry(action.entry ?? action.value ?? action, {
      threadId: action.threadId,
      mode: action.mode,
      createdAt: action.createdAt,
    });
    if (!entry.threadId || !entry.displayText.trim()) return current;
    return [...current, entry];
  }

  const id = entryId(action);
  if (type === "clearthread" || type === "threadclear" || type === "clear") {
    const threadId = textValue(action.threadId);
    return threadId ? current.filter((entry) => entry.threadId !== threadId) : [];
  }
  if (!id) return current;

  if (type === "remove" || type === "delete") return current.filter((entry) => entry.id !== id);
  return current.map((entry) => {
    if (entry.id !== id) return entry;
    switch (type) {
      case "sending":
      case "send":
        return {
          ...entry,
          status: "sending",
          attempts: entry.attempts + 1,
          error: null,
          requestId: action.requestId ?? entry.requestId,
        };
      case "accepted":
      case "accept":
        return { ...entry, status: "accepted", error: null, requestId: action.requestId ?? entry.requestId };
      case "failed":
      case "failure":
        return { ...entry, status: "failed", error: action.error ?? action.message ?? "Queue request failed" };
      case "retry":
        return { ...entry, status: "pending", error: null, requestId: null };
      default:
        return entry;
    }
  });
}

export const reduceQueue = queueReducer;

export function reduceQueueState(state = { entries: [] }, action = {}) {
  const entries = queueReducer(state?.entries ?? [], action);
  return { ...(state && typeof state === "object" ? state : {}), entries };
}

export function queueForThread(state, threadId) {
  const id = textValue(threadId);
  return (Array.isArray(state) ? state : []).filter((entry) => entry.threadId === id);
}

export function nextQueueEntry(state, threadId, { includeSending = false } = {}) {
  const first = queueForThread(state, threadId)[0];
  if (!first) return null;
  if (includeSending) return ["pending", "sending"].includes(first.status) ? first : null;
  return first.status === "pending" ? first : null;
}

export function queueCounts(state, threadId) {
  return queueForThread(state, threadId).reduce((counts, entry) => {
    counts.total += 1;
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, { total: 0, pending: 0, sending: 0, accepted: 0, failed: 0 });
}

export function isQueueEntryRetryable(entry) {
  return entry?.status === "failed";
}

export const QUEUE_ENTRY_MODES = QUEUE_MODES;
export const QUEUE_ENTRY_STATUSES = QUEUE_STATUSES;
export { QUEUE_MODES, QUEUE_STATUSES };
