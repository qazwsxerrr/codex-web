import { commandToolName } from "./command-presentation.js";

const PROCESS_TYPES = new Set([
  "thinking", "reasoning", "plan", "commandExecution", "fileChange", "mcpToolCall",
  "dynamicToolCall", "webSearch", "toolCall", "toolResult", "status", "error",
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
    return status.kind ?? status.status ?? status.state ?? status.type ?? status.result;
  }
  return status;
}

export function normalizeDisplayStatus(status) {
  const value = compactWhitespace(statusValue(status)).replace(/[\s_-]/g, "").toLowerCase();
  if (["inprogress", "running", "started", "active", "processing", "cancelling", "pending"].includes(value)) {
    return { kind: "running", label: "Running", tone: "success", isActive: true, isFailure: false };
  }
  if (["completed", "complete", "succeeded", "success", "done"].includes(value)) {
    return { kind: "completed", label: "Completed", tone: "success", isActive: false, isFailure: false };
  }
  if (["denied", "rejected", "forbidden"].includes(value)) {
    return { kind: "denied", label: "Denied", tone: "danger", isActive: false, isFailure: true };
  }
  if (["failed", "failure", "error", "errored"].includes(value)) {
    return { kind: "failed", label: "Failed", tone: "danger", isActive: false, isFailure: true };
  }
  if (["cancelled", "canceled", "aborted", "stopped", "interrupted"].includes(value)) {
    return { kind: "cancelled", label: "Cancelled", tone: "neutral", isActive: false, isFailure: false };
  }
  return { kind: "unknown", label: "Unknown", tone: "neutral", isActive: false, isFailure: false };
}

export function toolName(item = {}) {
  if (item.type === "commandExecution") return commandToolName(item);
  if (item.type === "read" || item.viewType === "read") return "read";
  if (item.type === "webSearch" || item.viewType === "search") return "web_search";
  if (item.type === "mcpToolCall") return item.tool || "mcp";
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
  return item.input ?? item.query ?? item.text ?? item.message ?? "";
}

export function originalToolInput(item = {}) {
  const value = inputValue(item);
  return value && typeof value === "object" ? jsonText(value) : asText(value);
}

export function toolInputPreview(item = {}, maxLength = 150) {
  const raw = compactWhitespace(originalToolInput(item));
  const requested = typeof maxLength === "object" ? maxLength?.maxLength : maxLength;
  const limit = Number(requested) > 0 ? Number(requested) : 150;
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, Math.max(1, limit - 3)).trimEnd()}...`;
}

export function presentTool(item = {}, options = {}) {
  const status = normalizeDisplayStatus(item.status ?? item.state ?? item.result);
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

export function buildProcessDetails(items = [], options = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const durations = list.map(itemDuration).filter((value) => value !== null);
  const durationMs = Number.isFinite(Number(options.durationMs))
    ? Number(options.durationMs)
    : durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
  const toolCount = list.filter((item) => PROCESS_TYPES.has(item.type) && !["thinking", "reasoning", "status", "error", "plan"].includes(item.type)).length;
  return {
    id: options.id ?? list.find((item) => item.id)?.turnId ?? null,
    items: list,
    messageCount: list.length,
    toolCount,
    counts: { messages: list.length, tools: toolCount },
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
