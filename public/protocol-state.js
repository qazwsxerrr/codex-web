import { protocolPartText } from "./protocol-text.js";

/**
 * Pure App Server event state helpers.
 *
 * The bridge can receive the same item through item/started, output deltas,
 * and item/completed.  This module keeps one canonical item per id while
 * retaining the first-seen ordering.  It does not mutate input events or the
 * previous state, so live and restored transcripts can share the reducer.
 */

const STATUS_ALIASES = new Map([
  ["inprogress", "running"],
  ["started", "running"],
  ["interacted", "running"],
  ["active", "running"],
  ["processing", "running"],
  ["cancelling", "running"],
  ["running", "running"],
  ["pending", "pending"],
  ["pendinginit", "waiting"],
  ["waiting", "waiting"],
  ["completed", "completed"],
  ["complete", "completed"],
  ["succeeded", "completed"],
  ["success", "completed"],
  ["done", "completed"],
  ["failed", "failed"],
  ["failure", "failed"],
  ["error", "failed"],
  ["errored", "failed"],
  ["denied", "denied"],
  ["declined", "denied"],
  ["rejected", "denied"],
  ["forbidden", "denied"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
  ["aborted", "cancelled"],
  ["stopped", "cancelled"],
  ["interrupted", "cancelled"],
  ["shutdown", "cancelled"],
  ["notfound", "failed"],
]);

// A terminal failure is more informative than a later stale success.  The
// values are deliberately exported through the helper below rather than used
// as UI labels.
export const PROTOCOL_STATUS_PRIORITY = Object.freeze({
  unknown: 0,
  pending: 10,
  running: 20,
  waiting: 25,
  completed: 40,
  cancelled: 45,
  failed: 50,
  denied: 50,
});

const TYPE_ALIASES = new Map([
  ["commandexecution", "commandExecution"],
  ["filechange", "fileChange"],
  ["mcptoolcall", "mcpToolCall"],
  ["websearch", "webSearch"],
  ["dynamictoolcall", "dynamicToolCall"],
  ["collabtoolcall", "collabToolCall"],
  ["collabagenttoolcall", "collabAgentToolCall"],
  ["subagentactivity", "subAgentActivity"],
  ["agentstatus", "agentStatus"],
  ["imagemessage", "imageView"],
  ["imageview", "imageView"],
  ["imagegeneration", "imageGeneration"],
  ["contextcompaction", "contextCompaction"],
  ["enteredreviewmode", "enteredReviewMode"],
  ["exitedreviewmode", "exitedReviewMode"],
  ["review", "review"],
  ["agentmessage", "agentMessage"],
  ["assistantmessage", "assistantMessage"],
  ["usermessage", "userMessage"],
  ["thinking", "thinking"],
  ["reasoning", "reasoning"],
  ["plan", "plan"],
  ["error", "error"],
  ["status", "status"],
  ["toolcall", "toolCall"],
  ["toolresult", "toolResult"],
  ["hookprompt", "hookPrompt"],
  ["sleep", "sleep"],
]);

const KNOWN_TYPES = new Set(TYPE_ALIASES.values());

const CATEGORY_BY_TYPE = Object.freeze({
  commandExecution: "commands",
  fileChange: "fileChanges",
  mcpToolCall: "mcp",
  webSearch: "webSearch",
  dynamicToolCall: "dynamicTools",
  collabToolCall: "agents",
  collabAgentToolCall: "agents",
  subAgentActivity: "agents",
  agentStatus: "agents",
  imageView: "imageViews",
  imageGeneration: "imageViews",
  contextCompaction: "compactions",
  enteredReviewMode: "reviews",
  exitedReviewMode: "reviews",
  review: "reviews",
  agentMessage: "messages",
  assistantMessage: "messages",
  userMessage: "messages",
  thinking: "messages",
  reasoning: "messages",
  plan: "messages",
  error: "messages",
  status: "messages",
  hookPrompt: "messages",
  sleep: "messages",
});

const TOOL_TYPES = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "webSearch",
  "dynamicToolCall", "collabToolCall", "collabAgentToolCall", "subAgentActivity",
]);

const EMPTY_COUNTS = Object.freeze({
  messages: 0,
  tools: 0,
  commands: 0,
  actions: 0,
  fileChanges: 0,
  mcp: 0,
  webSearch: 0,
  agents: 0,
  dynamicTools: 0,
  imageViews: 0,
  compactions: 0,
  reviews: 0,
  unknown: 0,
});

function asText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function typeKey(value) {
  return asText(value).replace(/[\s_-]/g, "").toLowerCase();
}

function itemTypeValue(itemOrType) {
  if (itemOrType && typeof itemOrType === "object") {
    return itemOrType.type ?? itemOrType.viewType ?? "";
  }
  return itemOrType;
}

/** Return the canonical protocol spelling for known types and preserve unknown types. */
export function normalizeProtocolType(itemOrType) {
  const raw = asText(itemTypeValue(itemOrType)).trim();
  if (!raw) return "unknown";
  return TYPE_ALIASES.get(typeKey(raw)) || raw;
}

export function isKnownProtocolType(itemOrType) {
  return KNOWN_TYPES.has(normalizeProtocolType(itemOrType));
}

function statusValue(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.activeFlags) && value.activeFlags.length) return "running";
    return value.kind ?? value.status ?? value.state ?? value.type ?? value.result;
  }
  return value;
}

/** Normalize App Server status variants without inventing a UI object. */
export function normalizeProtocolStatus(value) {
  const raw = typeKey(statusValue(value));
  return STATUS_ALIASES.get(raw) || "unknown";
}

export function protocolStatusPriority(value) {
  return PROTOCOL_STATUS_PRIORITY[normalizeProtocolStatus(value)] ?? 0;
}

export const statusPriority = protocolStatusPriority;

function hasId(item) {
  return Boolean(item && item.id !== undefined && item.id !== null && String(item.id) !== "");
}

function commandActionsFromItem(item) {
  if (Array.isArray(item?.commandActions)) return item.commandActions;
  if (Array.isArray(item?.parsed_cmd)) return item.parsed_cmd;
  if (Array.isArray(item?.parsedCmd)) return item.parsedCmd;
  return [];
}

export function classifyProtocolItem(item = {}) {
  const type = normalizeProtocolType(item);
  const known = isKnownProtocolType(type);
  const category = CATEGORY_BY_TYPE[type] || "unknown";
  return {
    type,
    category,
    known,
    isTool: TOOL_TYPES.has(type),
    isMessage: category === "messages",
  };
}

function emptyCounts() {
  return { ...EMPTY_COUNTS };
}

function mapEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value);
}

function cloneMap(value) {
  return new Map(mapEntries(value));
}

function cloneSet(value) {
  return value instanceof Set ? new Set(value) : new Set(Array.isArray(value) ? value : []);
}

function itemListFromState(state) {
  if (Array.isArray(state?.items)) return state.items;
  return mapEntries(state?.itemsById || state?.activeItems).map(([, item]) => item);
}

function planListFromState(state) {
  return cloneMap(state?.plans || state?.planSnapshots);
}

function cloneState(state = {}) {
  const sourceItems = Array.isArray(state.items) ? state.items : [];
  const sourceItemMap = state.itemsById || state.activeItems;
  const itemsById = cloneMap(sourceItemMap);
  if (!sourceItemMap) {
    for (const item of sourceItems) {
      if (hasId(item)) itemsById.set(String(item.id), item);
    }
  }
  const itemSequences = cloneMap(state.itemSequences);
  const plans = planListFromState(state);
  const planSequences = cloneMap(state.planSequences);
  const items = sourceItems.length ? [...sourceItems] : [...itemsById.values()];
  const orderedEvents = Array.isArray(state.orderedEvents) ? state.orderedEvents.map((entry) => ({ ...entry })) : [];
  const storedSequence = Number.isFinite(Number(state.sequence)) ? Number(state.sequence) : 0;
  const sequence = Math.max(storedSequence, ...orderedEvents.map((entry) => Number(entry.sequence) || 0));
  const unknownItems = Array.isArray(state.unknownItems) ? [...state.unknownItems] : [];
  return {
    threadId: state.threadId ?? null,
    turnId: state.turnId ?? null,
    sequence,
    items,
    itemsById,
    activeItems: itemsById,
    itemSequences,
    completedItems: cloneSet(state.completedItems),
    plans,
    planSnapshots: plans,
    planSequences,
    orderedEvents,
    unknownItems,
    counts: { ...emptyCounts(), ...(state.counts || {}) },
  };
}

export function createProtocolState(initial = {}) {
  const state = cloneState(initial && typeof initial === "object" ? initial : {});
  state.counts = summarizeProtocolCounts(state.items);
  state.unknownItems = state.items.filter((item) => !isKnownProtocolType(item));
  return state;
}

function nextSequence(state) {
  state.sequence += 1;
  return state.sequence;
}

function orderedEntryIndex(state, key) {
  return state.orderedEvents.findIndex((entry) => entry.key === key);
}

function upsertOrderedEntry(state, key, entry) {
  const index = orderedEntryIndex(state, key);
  if (index >= 0) state.orderedEvents[index] = { ...state.orderedEvents[index], ...entry, key };
  else state.orderedEvents.push({ key, sequence: nextSequence(state), ...entry });
  return state.orderedEvents.find((candidate) => candidate.key === key)?.sequence ?? null;
}

function eventMethod(event) {
  return asText(event?.method ?? event?.event ?? "");
}

function methodStatus(method) {
  if (/\/completed$/.test(method)) return "completed";
  if (/\/started$/.test(method)) return "running";
  if (/\/waiting$/.test(method)) return "waiting";
  return "unknown";
}

function inferTypeFromMethod(method) {
  const match = method.match(/^item\/([^/]+)/);
  if (!match) return "unknown";
  return normalizeProtocolType(match[1]);
}

function eventParams(event) {
  if (event?.params && typeof event.params === "object") return event.params;
  return event && typeof event === "object" ? event : {};
}

function eventItem(event) {
  const params = eventParams(event);
  if (params.item && typeof params.item === "object") return params.item;
  if (params.itemId !== undefined && params.itemId !== null) {
    const supplemental = { ...params };
    for (const key of ["itemId", "threadId", "turnId", "delta", "outputDelta"]) delete supplemental[key];
    return { id: params.itemId, type: inferTypeFromMethod(eventMethod(event)), ...supplemental };
  }
  if (!event?.method && (params.type || params.viewType || params.id)) return params;
  return null;
}

function replaceItemInList(state, item, id) {
  const index = id === null ? -1 : state.items.findIndex((candidate) => String(candidate?.id) === id);
  if (index >= 0) state.items[index] = item;
  else state.items.push(item);
}

function applyOutputDelta(current, params, type) {
  const delta = params.delta ?? params.outputDelta ?? "";
  if (delta === "") return current;
  const previous = current.aggregatedOutput ?? current.output ?? "";
  return {
    ...current,
    type: current.type || type,
    aggregatedOutput: `${asText(previous)}${asText(delta)}`,
  };
}

function applyTerminalInteraction(current, params) {
  if (params.stdin === undefined || params.stdin === null) return current;
  const interactions = Array.isArray(current.terminalInteractions)
    ? [...current.terminalInteractions]
    : [];
  interactions.push({
    processId: params.processId ?? null,
    stdin: asText(params.stdin),
  });
  return {
    ...current,
    terminalInteractions: interactions,
    lastStdin: asText(params.stdin),
  };
}

function applyTextDelta(current, params, type) {
  const delta = params.delta ?? "";
  if (delta === "") return current;
  return { ...current, type: current.type || type, text: `${asText(current.text)}${asText(delta)}` };
}

function applyReasoningEvent(current, params, method) {
  const summaryIndex = params.summaryIndex ?? params.contentIndex ?? 0;
  const next = { ...current, type: current.type || "reasoning", summaryIndex };
  const parts = { ...(current.reasoningParts || {}) };
  const collectionKey = method.includes("summaryText") || method.endsWith("summaryPartAdded") ? "summary" : "content";
  const collection = Array.isArray(current[collectionKey]) ? [...current[collectionKey]] : [];
  if (method.endsWith("summaryPartAdded")) {
    if (parts[summaryIndex] === undefined) parts[summaryIndex] = "";
    if (collection[summaryIndex] === undefined) collection[summaryIndex] = "";
    else collection[summaryIndex] = protocolPartText(collection[summaryIndex]);
    return { ...next, [collectionKey]: collection, reasoningParts: parts };
  }
  const delta = params.delta ?? "";
  if (delta === "") return { ...next, [collectionKey]: collection, reasoningParts: parts };
  const partKey = String(summaryIndex);
  parts[partKey] = `${protocolPartText(parts[partKey])}${asText(delta)}`;
  collection[summaryIndex] = `${protocolPartText(collection[summaryIndex])}${asText(delta)}`;
  const field = collectionKey === "summary" ? "summaryText" : "text";
  return {
    ...next,
    [field]: `${protocolPartText(next[field])}${asText(delta)}`,
    [collectionKey]: collection,
    reasoningParts: parts,
  };
}

function itemStatus(item, method, params) {
  const explicit = item?.status ?? item?.state ?? item?.result ?? params?.status;
  if (explicit !== undefined) return normalizeProtocolStatus(explicit);
  const inferred = methodStatus(method);
  if (inferred !== "unknown") return inferred;
  return normalizeProtocolStatus(item?.kind ?? params?.kind);
}

function mergeItem(previous, incoming, method, params) {
  const next = { ...(previous || {}), ...(incoming || {}) };
  const incomingStatus = itemStatus(incoming, method, params);
  const previousStatus = previous ? normalizeProtocolStatus(previous.status ?? previous.state ?? previous.result) : "unknown";
  if (incomingStatus !== "unknown"
    && (previousStatus === "unknown" || protocolStatusPriority(incomingStatus) >= protocolStatusPriority(previousStatus))) {
    next.status = incomingStatus;
  } else if (previousStatus !== "unknown") {
    next.status = previousStatus;
  }
  return next;
}

function applyItemInPlace(state, rawItem, metadata = {}) {
  const params = metadata.params || {};
  const method = metadata.method || "";
  const inferredType = metadata.type || inferTypeFromMethod(method);
  if (params.threadId !== undefined && params.threadId !== null) state.threadId = params.threadId;
  if (params.turnId !== undefined && params.turnId !== null) state.turnId = params.turnId;
  let incoming = rawItem && typeof rawItem === "object" ? { ...rawItem } : { type: inferredType };
  if (!incoming.type || incoming.type === "unknown") incoming.type = inferredType;
  // Lifecycle timestamps and thread context live on the notification envelope
  // in the current App Server schema, not necessarily on the ThreadItem.
  for (const key of ["threadId", "turnId", "startedAtMs", "completedAtMs"]) {
    if (incoming[key] === undefined && params[key] !== undefined) incoming[key] = params[key];
  }
  const id = hasId(incoming) ? String(incoming.id) : null;
  const previous = id === null ? null : state.itemsById.get(id);
  if (method.endsWith("/outputDelta")) incoming = applyOutputDelta(previous || incoming, params, inferredType);
  if (method.endsWith("/terminalInteraction")) incoming = applyTerminalInteraction(previous || incoming, params);
  if (method.includes("/reasoning/") && (method.endsWith("Delta") || method.endsWith("PartAdded"))) {
    incoming = applyReasoningEvent(previous || incoming, params, method);
  } else if (method.endsWith("/delta") && !method.endsWith("/outputDelta")) {
    incoming = applyTextDelta(previous || incoming, params, inferredType);
  }
  const merged = mergeItem(previous, incoming, method, params);
  if (id !== null) state.itemsById.set(id, merged);
  replaceItemInList(state, merged, id);

  const key = id === null ? `event:${nextSequence(state)}` : `item:${id}`;
  const sequence = upsertOrderedEntry(state, key, {
    kind: "item",
    itemId: id,
    type: normalizeProtocolType(merged),
    item: merged,
    method: method || null,
  });
  if (id !== null) {
    state.itemSequences.set(id, sequence);
    if (["completed", "failed", "denied", "cancelled"].includes(normalizeProtocolStatus(merged.status))) {
      state.completedItems.add(id);
    }
  }
  state.unknownItems = state.items.filter((item) => !isKnownProtocolType(item));
  state.counts = summarizeProtocolCounts(state.items);
  return state;
}

/** Upsert one item without mutating the supplied state. */
export function upsertProtocolItem(state, item, metadata = {}) {
  const next = cloneState(state || createProtocolState());
  return applyItemInPlace(next, item, metadata);
}

function planSource(params) {
  if (params?.snapshot && typeof params.snapshot === "object") return { ...params, ...params.snapshot };
  return params && typeof params === "object" ? params : {};
}

function normalizePlan(params, fallback = {}, previous = null) {
  const source = planSource(params);
  const threadId = source.threadId ?? fallback.threadId ?? previous?.threadId ?? null;
  const turnId = source.turnId ?? fallback.turnId ?? previous?.turnId ?? null;
  const hasSteps = Array.isArray(source.steps) || Array.isArray(source.plan);
  const rawSteps = Array.isArray(source.steps) ? source.steps : Array.isArray(source.plan) ? source.plan : previous?.steps || [];
  return {
    threadId,
    turnId,
    explanation: source.explanation ?? previous?.explanation ?? null,
    steps: rawSteps.map((step, index) => {
      const value = step && typeof step === "object" ? step : { step: asText(step) };
      return {
        id: String(value.id ?? index),
        index,
        step: asText(value.step ?? value.text),
        status: normalizePlanStatus(value.status),
      };
    }),
    ...(source.text !== undefined || previous?.text !== undefined ? { text: source.text ?? previous?.text ?? "" } : {}),
    ...(hasSteps ? {} : { fallback: true }),
  };
}

function normalizePlanStatus(value) {
  const raw = typeKey(statusValue(value));
  if (["pending"].includes(raw)) return "pending";
  if (["inprogress", "working", "active", "running"].includes(raw)) return "inProgress";
  if (["completed", "complete", "done", "succeeded", "success"].includes(raw)) return "completed";
  return "unknown";
}

/** Upsert one structured plan snapshot by threadId + turnId. */
export function upsertPlanSnapshot(state, params, metadata = {}) {
  const next = cloneState(state || createProtocolState());
  const fallback = {
    threadId: metadata.threadId ?? next.threadId ?? null,
    turnId: metadata.turnId ?? next.turnId ?? null,
  };
  const source = planSource(params);
  const key = `${String(source.threadId ?? fallback.threadId ?? "thread")}:${String(source.turnId ?? fallback.turnId ?? "turn")}`;
  const previous = next.plans.get(key) || null;
  const snapshot = normalizePlan(source, fallback, previous);
  next.plans.set(key, snapshot);
  const sequence = upsertOrderedEntry(next, `plan:${key}`, {
    kind: "plan",
    planKey: key,
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    snapshot,
    method: metadata.method || "turn/plan/updated",
  });
  next.planSequences.set(key, sequence);
  return next;
}

function isPlanNotification(method) {
  return method === "turn/plan/updated";
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") return { method: "", params: {}, item: null };
  const method = eventMethod(event);
  return { method, params: eventParams(event), item: eventItem(event) };
}

function applyEventContext(state, params = {}) {
  if (params.threadId !== undefined && params.threadId !== null) state.threadId = params.threadId;
  if (params.turnId !== undefined && params.turnId !== null) state.turnId = params.turnId;
  if (params.turn?.id !== undefined && params.turn?.id !== null) state.turnId = params.turn.id;
  return state;
}

/** Apply one App Server notification or direct item immutably. */
export function reduceProtocolState(state, event) {
  const parsed = normalizeEvent(event);
  const base = applyEventContext(createProtocolState(state || {}), parsed.params);
  if (isPlanNotification(parsed.method)) {
    return upsertPlanSnapshot(base, parsed.params, {
      method: parsed.method,
      threadId: parsed.params.threadId,
      turnId: parsed.params.turnId,
    });
  }
  if (parsed.method === "turn/started" || parsed.method === "turn/completed") {
    const turn = parsed.params.turn;
    if (turn && typeof turn === "object") {
      return upsertProtocolItem(base, { ...turn, type: turn.type || "status" }, {
        method: parsed.method,
        params: parsed.params,
        type: turn.type || "status",
      });
    }
    return base;
  }
  if (!parsed.item) return base;
  return upsertProtocolItem(base, parsed.item, {
    method: parsed.method,
    params: parsed.params,
  });
}

export const applyProtocolEvent = reduceProtocolState;
export const reduceProtocolEvent = reduceProtocolState;
export const updateProtocolState = reduceProtocolState;

export function reduceProtocolEvents(state, events = []) {
  return (Array.isArray(events) ? events : []).reduce(reduceProtocolState, state || createProtocolState());
}

export const applyProtocolEvents = reduceProtocolEvents;

export function getProtocolItem(state, id) {
  if (!state || id === undefined || id === null) return null;
  const items = state.itemsById || state.activeItems;
  if (items instanceof Map) return items.get(id) ?? items.get(String(id)) ?? null;
  return items?.[id] ?? items?.[String(id)] ?? null;
}

export function summarizeProtocolCounts(items = []) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const counts = emptyCounts();
  const seen = new Set();
  for (const item of list) {
    const id = hasId(item) ? String(item.id) : null;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const detail = classifyProtocolItem(item);
    const category = detail.category;
    if (category in counts && category !== "unknown") counts[category] += 1;
    if (detail.isTool && ["commands", "fileChanges", "mcp", "webSearch"].includes(category)) counts.tools += 1;
    if (detail.type === "commandExecution") counts.actions += commandActionsFromItem(item).length;
    if (!detail.known) counts.unknown += 1;
  }
  return counts;
}

/** Return a serializable view for sessionStorage/debug output. */
export function toProtocolSnapshot(state = {}) {
  const items = itemListFromState(state).map((item) => ({ ...item }));
  const plans = Object.fromEntries(mapEntries(state.plans || state.planSnapshots));
  return {
    threadId: state.threadId ?? null,
    turnId: state.turnId ?? null,
    sequence: Number(state.sequence) || 0,
    items,
    plans,
    orderedEvents: Array.isArray(state.orderedEvents) ? state.orderedEvents.map((entry) => ({ ...entry })) : [],
    unknownItems: items.filter((item) => !isKnownProtocolType(item)),
    counts: summarizeProtocolCounts(items),
  };
}
