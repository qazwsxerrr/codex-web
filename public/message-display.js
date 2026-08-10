import { commandToolName, summarizeProcessActivities, toolPreviewValue } from "./command-presentation.js";
import { reasoningText } from "./protocol-text.js";

const PROCESS_TYPES = new Set([
  "thinking", "reasoning", "plan", "commandExecution", "fileChange", "mcpToolCall",
  "dynamicToolCall", "webSearch", "toolCall", "toolResult", "status", "error",
  "collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus", "imageView",
  "imageGeneration", "hookPrompt", "sleep",
  "contextCompaction", "enteredReviewMode", "exitedReviewMode", "review",
]);

const TOOL_CALL_TYPES = new Set([
  "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch",
  "collabToolCall", "collabAgentToolCall", "subAgentActivity", "imageView", "imageGeneration",
]);

function asText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function compactWhitespace(value) {
  return asText(value).replace(/\s+/g, " ").trim();
}

function jsonText(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return "[unserializable input]"; }
}

function statusValue(status) {
  if (status && typeof status === "object") {
    if (Array.isArray(status.activeFlags) && status.activeFlags.length) return "running";
    return status.kind ?? status.status ?? status.state ?? status.type ?? status.result;
  }
  return status;
}

export function normalizeDisplayStatus(status) {
  const value = compactWhitespace(statusValue(status)).replace(/[\s_-]/g, "").toLowerCase();
  if (["inprogress", "running", "started", "interacted", "active", "processing", "cancelling", "pending"].includes(value)) {
    return { kind: "running", label: "Running", tone: "success", isActive: true, isFailure: false };
  }
  if (["pendinginit", "waiting"].includes(value)) {
    return { kind: "waiting", label: "Waiting", tone: "warning", isActive: true, isFailure: false };
  }
  if (["completed", "complete", "succeeded", "success", "done"].includes(value)) {
    return { kind: "completed", label: "Completed", tone: "success", isActive: false, isFailure: false };
  }
  if (["denied", "declined", "rejected", "forbidden"].includes(value)) {
    return { kind: "denied", label: "Denied", tone: "danger", isActive: false, isFailure: true };
  }
  if (["failed", "failure", "error", "errored"].includes(value)) {
    return { kind: "failed", label: "Failed", tone: "danger", isActive: false, isFailure: true };
  }
  if (["cancelled", "canceled", "aborted", "stopped", "interrupted", "shutdown"].includes(value)) {
    return { kind: "cancelled", label: "Cancelled", tone: "neutral", isActive: false, isFailure: false };
  }
  return { kind: "unknown", label: "Unknown", tone: "neutral", isActive: false, isFailure: false };
}

export function toolName(item = {}) {
  if (item.type === "commandExecution" || item.viewType === "command") return commandToolName(item);
  if (item.type === "read" || item.viewType === "read") return "read";
  if (item.type === "webSearch" || item.viewType === "search") return "web_search";
  if (item.type === "mcpToolCall") return item.tool || "mcp";
  if (item.type === "dynamicToolCall") return item.tool || item.name || "dynamic_tool";
  if (["collabToolCall", "collabAgentToolCall", "subAgentActivity"].includes(item.type)) {
    return item.agentName || item.agent || item.agentPath || item.agentThreadId || item.name || item.tool || "agent";
  }
  if (item.type === "agentStatus") return item.agentName || item.agent || item.agentPath || item.agentThreadId || "agent";
  if (item.type === "imageView") return "image_view";
  if (item.type === "imageGeneration") return "image_generation";
  if (item.type === "fileChange" || item.viewType === "change") return "edit";
  return item.name || item.tool || item.type || "tool";
}

function inputValue(item = {}) {
  if (item.type === "commandExecution" || item.command !== undefined || item.commandLine !== undefined) {
    return item.command ?? item.commandLine ?? item.rawCommand ?? item.input;
  }
  if (item.type === "read" || item.viewType === "read") {
    return item.path ?? item.filePath ?? item.file ?? item.input ?? item.query;
  }
  if (item.type === "webSearch" || item.viewType === "search") {
    return item.query ?? item.searchQuery ?? item.input;
  }
  if (item.type === "mcpToolCall") {
    return item.input ?? item.arguments ?? item.params ?? item.parameters ?? item.tool;
  }
  if (item.type === "dynamicToolCall") {
    return item.input ?? item.arguments ?? item.params ?? item.parameters ?? item.tool ?? item.name;
  }
  if (["collabToolCall", "collabAgentToolCall", "subAgentActivity"].includes(item.type)) {
    return item.agentName ?? item.agent ?? item.agentPath ?? item.agentThreadId ?? item.name ?? item.tool ?? item.task ?? item.prompt ?? item.input;
  }
  if (item.type === "agentStatus") return item.agentName ?? item.agent ?? item.agentPath ?? item.agentThreadId ?? item.message ?? item.input;
  if (item.type === "imageView") return item.path ?? item.url ?? item.input ?? item.image;
  if (item.type === "fileChange" || item.viewType === "change") {
    return item.changes ?? item.files ?? item.diff ?? item.patch ?? item.input ?? "";
  }
  return item.input ?? item.query ?? item.text ?? item.message ?? "";
}

export function originalToolInput(item = {}) {
  const value = inputValue(item);
  return value && typeof value === "object" ? jsonText(value) : asText(value);
}

export function toolInputPreview(item = {}, maxLength = 120) {
  const requested = typeof maxLength === "object" ? maxLength?.maxLength : maxLength;
  const limit = Number(requested) > 0 ? Number(requested) : 120;
  // Keep this helper in sync with the command presentation layer while
  // retaining the public message-display API used by restored transcripts.
  const raw = compactWhitespace(originalToolInput(item));
  const preferredValue = toolPreviewValue(item);
  const preferred = compactWhitespace(preferredValue && typeof preferredValue === "object"
    ? jsonText(preferredValue)
    : asText(preferredValue));
  const value = preferred || raw;
  return value.length <= limit ? value : value.slice(0, limit).trimEnd();
}

/** The visual type shown at the start of every Pi-style tool row. */
export function toolType(item = {}) {
  return toolName(item);
}

export function isToolCallItem(item) {
  return Boolean(item && TOOL_CALL_TYPES.has(item.type));
}

export function activityCategory(item = {}) {
  const type = item?.type || item?.viewType || "unknown";
  return {
    commandExecution: "commands",
    fileChange: "fileChanges",
    mcpToolCall: "mcp",
    dynamicToolCall: "dynamicTools",
    webSearch: "webSearch",
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
  }[type] || null;
}

function hasDisplayableText(item) {
  if (!item || typeof item !== "object") return false;
  if (item.role === "assistant" || item.type === "agentMessage" || item.type === "assistantMessage") {
    return getAssistantBlocks(item).some((block) => {
      if (block?.type === "thinking" || block?.type === "reasoning") return asText(block.thinking ?? block.text).trim().length > 0;
      return block?.type === "text" || block?.type === "image";
    });
  }
  return Boolean(asText(item.text ?? item.message ?? item.thinking ?? item.reasoning ?? item.explanation ?? item.planText ?? reasoningText(item)).trim());
}

/** A process item that contributes to the `N messages` part of the header. */
export function isDisplayableProcessItem(item) {
  return Boolean(item && !isToolCallItem(item) && (isProcessItem(item) || hasDisplayableText(item)) && hasDisplayableText(item));
}

function modelIdFrom(value) {
  if (value && typeof value === "object") return value.id || value.model || value.slug || value.name || "";
  return value === null || value === undefined ? "" : String(value);
}

function modelDisplayNameFrom(value) {
  if (!value || typeof value !== "object") return "";
  return value.displayName || value.display_name || value.label || value.name || "";
}

/**
 * Resolve the stable model label used by an assistant message.
 *
 * The model id is intentionally returned separately so callers can freeze it
 * when a message is created.  Metadata updates may fill in a display name for
 * that same id, but a later selector change must not rewrite old messages.
 */
export function resolveModelDisplayName({ message, turn, thread, models = [], modelId, fallback = "Codex" } = {}) {
  const messageModel = message?.model ?? message?.modelId ?? message?.model_id;
  const turnModel = turn?.model ?? turn?.modelId ?? turn?.model_id;
  const threadModel = thread?.model ?? thread?.modelId ?? thread?.model_id;
  const selected = modelId || messageModel || turnModel || threadModel;
  const id = modelIdFrom(selected);
  const direct = [messageModel, turnModel, threadModel]
    .find((candidate) => modelDisplayNameFrom(candidate) && (!id || modelIdFrom(candidate) === id));
  const directLabel = modelDisplayNameFrom(direct);
  if (directLabel) return { id, label: directLabel, resolved: true };
  const model = (Array.isArray(models) ? models : []).find((entry) => modelIdFrom(entry) === id);
  const displayName = modelDisplayNameFrom(model);
  if (displayName) return { id, label: displayName, resolved: true };
  return { id, label: fallback, resolved: false };
}

export function modelDisplayName(options = {}) {
  return resolveModelDisplayName(options).label;
}

export const getModelDisplayName = modelDisplayName;
export const resolveAssistantModelLabel = modelDisplayName;

export function presentTool(item = {}, options = {}) {
  const status = normalizeDisplayStatus(item.status ?? item.state ?? item.result ?? item.kind);
  const rawInput = originalToolInput(item);
  const inputPreview = toolInputPreview(item, options.maxLength);
  return {
    id: item.id ?? null,
    type: item.type ?? item.viewType ?? "tool",
    name: toolName(item),
    rawInput,
    inputPreview: inputPreview || "(no input)",
    status,
    cwd: item.cwd ?? null,
    durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : null,
    exitCode: item.exitCode ?? null,
  };
}

export function isProcessItem(item) {
  if (!item || typeof item !== "object") return false;
  if (PROCESS_TYPES.has(item.type) || PROCESS_TYPES.has(item.viewType)) return true;
  if (item.role === "assistant") return getAssistantBlocks(item).some((block) => !isAnswerBlock(block));
  return false;
}

export function isAnswerItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "agentMessage" || item.type === "assistantMessage" || item.role === "assistant") {
    const blocks = getAssistantBlocks(item);
    return blocks.length > 0 && blocks.every(isAnswerBlock);
  }
  return false;
}

function getAssistantBlocks(message = {}) {
  if (Array.isArray(message.content)) return message.content;
  if (message.text !== undefined) return [{ type: "text", text: asText(message.text) }];
  if (message.thinking !== undefined) return [{ type: "thinking", thinking: asText(message.thinking) }];
  return [];
}

function isAnswerBlock(block) {
  return block?.type === "text" || block?.type === "image";
}

export function splitAssistantProcess(message = {}) {
  const blocks = getAssistantBlocks(message).filter((block) => !(block?.type === "thinking" && !asText(block.thinking).trim() && !message.isStreaming));
  const lastProcess = blocks.findLastIndex((block) => !isAnswerBlock(block));
  if (lastProcess < 0) return { processBlocks: [], answerBlocks: blocks };
  return { processBlocks: blocks.slice(0, lastProcess + 1), answerBlocks: blocks.slice(lastProcess + 1) };
}

export const splitFinalAssistantBlocks = splitAssistantProcess;
export const splitMessageDisplay = splitAssistantProcess;

function itemDuration(item) {
  const value = Number(item?.durationMs);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function dedupeProcessItems(items) {
  const result = [];
  const positions = new Map();
  for (const item of Array.isArray(items) ? items.filter(Boolean) : []) {
    const id = item?.id;
    if (id === undefined || id === null || String(id) === "") {
      result.push(item);
      continue;
    }
    const key = String(id);
    if (!positions.has(key)) {
      positions.set(key, result.length);
      result.push(item);
    } else {
      result[positions.get(key)] = item;
    }
  }
  return result;
}

export function buildProcessDetails(items = [], options = {}) {
  const list = dedupeProcessItems(items);
  const durations = list.map(itemDuration).filter((value) => value !== null);
  const durationMs = Number.isFinite(Number(options.durationMs))
    ? Number(options.durationMs)
    : durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
  const toolCount = list.filter(isToolCallItem).length;
  const messageCount = list.filter(isDisplayableProcessItem).length;
  const activityCounts = summarizeProcessActivities(list);
  return {
    id: options.id ?? list.find((item) => item.id)?.turnId ?? null,
    items: list,
    messageCount,
    toolCount,
    counts: { messages: messageCount, tools: toolCount, ...activityCounts },
    activityCounts,
    durationMs,
    status: normalizeDisplayStatus(options.status ?? list.at(-1)?.status ?? "completed").kind,
  };
}

export function buildProcessGroups(turns = []) {
  const groups = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const userIndex = items.findIndex((item) => item?.type === "userMessage" || item?.role === "user");
    if (userIndex < 0) continue;
    const rest = items.slice(userIndex + 1);
    const answerIndex = rest.findLastIndex((item) => item?.type === "agentMessage" || item?.type === "assistantMessage" || item?.role === "assistant");
    const processItems = (answerIndex >= 0 ? rest.slice(0, answerIndex) : rest).filter((item) => isProcessItem(item) || item?.role === "assistant");
    const answer = answerIndex >= 0 ? rest[answerIndex] : null;
    groups.push({
      turnId: turn.id ?? null,
      user: items[userIndex],
      process: buildProcessDetails(processItems, { id: `${turn.id || "turn"}:process`, durationMs: turn.durationMs }),
      answer,
    });
  }
  return groups;
}

export const buildConversationProcessGroups = buildProcessGroups;

export const getOriginalToolInput = originalToolInput;
export const getToolInputPreview = toolInputPreview;
export const normalizeToolDisplayStatus = normalizeDisplayStatus;
