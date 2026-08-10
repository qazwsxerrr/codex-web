import { presentCommand } from "./command-presentation.js";
import {
  buildProcessDetails,
  isAnswerItem,
  isProcessItem,
  splitAssistantProcess,
} from "./message-display.js";

const COMMAND_TYPES = new Set(["commandExecution"]);

function itemWithTurn(item, turn, index) {
  const model = item?.model ?? item?.modelId ?? turn?.model ?? turn?.modelId;
  return {
    ...(item && typeof item === "object" ? item : {}),
    id: item?.id || `${turn?.id || "turn"}:item:${index}`,
    turnId: item?.turnId ?? turn?.id ?? null,
    turnStatus: item?.turnStatus ?? turn?.status ?? null,
    startedAt: item?.startedAt ?? turn?.startedAt ?? null,
    turnDurationMs: item?.turnDurationMs ?? turn?.durationMs ?? null,
    ...(model !== undefined && model !== null ? { model } : {}),
  };
}

function commandDetails(item, options = {}) {
  const durationMs = item?.durationMs !== null && item?.durationMs !== undefined && item?.durationMs !== "" && Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : undefined;
  const presentation = presentCommand(item, { ...options, durationMs });
  return { item, presentation };
}

function isCommand(item) {
  return COMMAND_TYPES.has(item?.type) || item?.viewType === "command";
}

export function buildConversationBlocks(turns, options = {}) {
  const blocks = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const turnId = turn?.id || null;
    for (const [index, rawItem] of (Array.isArray(turn?.items) ? turn.items : []).entries()) {
      const item = itemWithTurn(rawItem, turn, index);
      if (isCommand(item)) {
        const details = commandDetails(item, options);
        blocks.push({ type: "command", turnId, item, presentation: details.presentation });
        continue;
      }

      if (item.type === "userMessage" || item.type === "agentMessage" || item.viewType === "message") {
        blocks.push({ type: "message", turnId, item, role: item.type === "userMessage" || item.role === "user" ? "user" : "assistant" });
      } else if (item.type === "fileChange" || item.viewType === "change") {
        blocks.push({ type: "fileChange", turnId, item });
      } else if (item.type === "mcpToolCall" || item.viewType === "mcp") {
        blocks.push({ type: "mcpTool", turnId, item });
      } else if (item.type === "dynamicToolCall" || item.viewType === "dynamicTool") {
        blocks.push({ type: "dynamicTool", turnId, item });
      } else if (["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(item.type) || item.viewType === "agent") {
        blocks.push({ type: "agent", turnId, item });
      } else if (["imageView", "imageGeneration"].includes(item.type) || item.viewType === "imageView") {
        blocks.push({ type: "imageView", turnId, item });
      } else if (["hookPrompt", "sleep"].includes(item.type)) {
        blocks.push({ type: "status", turnId, item });
      } else if (item.type === "contextCompaction" || item.viewType === "compaction") {
        blocks.push({ type: "compaction", turnId, item });
      } else if (["enteredReviewMode", "exitedReviewMode", "review"].includes(item.type) || item.viewType === "review") {
        blocks.push({ type: "review", turnId, item });
      } else if (item.type === "webSearch" || item.viewType === "search") {
        blocks.push({ type: "search", turnId, item });
      } else if (item.type === "plan" || item.viewType === "plan") {
        blocks.push({ type: "plan", turnId, item });
      } else if (["reasoning", "thinking"].includes(item.type) || item.viewType === "reasoning") {
        blocks.push({ type: "reasoning", turnId, item });
      } else if (item.type === "error" || item.viewType === "error") {
        blocks.push({ type: "error", turnId, item });
      } else {
        blocks.push({ type: "unknown", turnId, item });
      }
    }
  }
  return blocks;
}

export function mergeCachedTools(thread, cachedEntries) {
  const turns = (Array.isArray(thread?.turns) ? thread.turns : []).map((turn) => ({
    ...turn,
    items: Array.isArray(turn.items) ? [...turn.items] : [],
  }));
  if (!Array.isArray(cachedEntries) || !cachedEntries.length || !turns.length) return { ...thread, turns };
  const existingIds = new Set(turns.flatMap((turn) => turn.items.map((item) => item?.id)).filter(Boolean));
  const turnById = new Map(turns.map((turn) => [turn.id, turn]));
  for (const entry of [...cachedEntries].sort((left, right) => left.sequence - right.sequence)) {
    const item = entry?.item;
    if (!item?.id || existingIds.has(item.id)) continue;
    const turn = turnById.get(entry.turnId) || turns.at(-1);
    if (!turn) continue;
    const previousIndex = entry.previousItemId
      ? turn.items.findIndex((candidate) => candidate?.id === entry.previousItemId)
      : -1;
    const fallbackIndex = turn.items.findIndex((candidate) => candidate?.type === "agentMessage");
    const insertAt = previousIndex >= 0 ? previousIndex + 1 : fallbackIndex >= 0 ? fallbackIndex : turn.items.length;
    turn.items.splice(insertAt, 0, { ...item });
    existingIds.add(item.id);
  }
  return { ...thread, turns };
}

function isUserItem(item) {
  return item?.type === "userMessage" || item?.role === "user";
}

function assistantAnswer(item) {
  if (!item || (!isAnswerItem(item) && item?.type !== "agentMessage" && item?.role !== "assistant")) return false;
  const split = splitAssistantProcess(item);
  return split.answerBlocks.length > 0;
}

/**
 * Return the user anchor, collapsed process payload, and final answer for one
 * turn. This is deliberately a pure data representation so live and restored
 * transcripts can use the same grouping rules.
 */
export function buildTurnProcessDetails(turn, options = {}) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const userIndex = items.findIndex(isUserItem);
  if (userIndex < 0) return null;
  const rest = items.slice(userIndex + 1);
  const answerIndex = rest.findLastIndex(assistantAnswer);
  const answer = answerIndex >= 0 ? rest[answerIndex] : null;
  const processItems = (answerIndex >= 0 ? rest.slice(0, answerIndex) : rest)
    .filter((item) => isProcessItem(item) || (item?.role === "assistant" && !assistantAnswer(item)));
  return {
    type: "turn",
    turnId: turn.id ?? null,
    user: items[userIndex],
    process: buildProcessDetails(processItems, {
      id: `${turn.id || "turn"}:process`,
      durationMs: options.durationMs ?? turn.durationMs,
      status: options.status ?? turn.status,
    }),
    answer,
    trailing: answerIndex >= 0 ? rest.slice(answerIndex + 1) : [],
  };
}

export function buildProcessDetailsForTurns(turns, options = {}) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => buildTurnProcessDetails(turn, options))
    .filter(Boolean);
}

export const buildProcessBlocks = buildProcessDetailsForTurns;
