import {
  classifyCommand,
  normalizeToolStatus,
  presentCommand,
} from "./command-presentation.js";

const COMMAND_TYPES = new Set(["commandExecution"]);

function itemWithTurn(item, turn, index) {
  return {
    ...(item && typeof item === "object" ? item : {}),
    id: item?.id || `${turn?.id || "turn"}:item:${index}`,
    turnId: item?.turnId ?? turn?.id ?? null,
    turnStatus: item?.turnStatus ?? turn?.status ?? null,
    startedAt: item?.startedAt ?? turn?.startedAt ?? null,
    turnDurationMs: item?.turnDurationMs ?? turn?.durationMs ?? null,
  };
}

function commandDetails(item, options = {}) {
  const durationMs = item?.durationMs !== null && item?.durationMs !== undefined && item?.durationMs !== "" && Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : undefined;
  const presentation = presentCommand(item, { ...options, durationMs });
  return { item, presentation, classification: classifyCommand(item?.command || "", { durationMs }) };
}

function isCommand(item) {
  return COMMAND_TYPES.has(item?.type) || item?.viewType === "command";
}

export function shouldKeepCommandStandalone(item, options = {}) {
  if (!isCommand(item)) return true;
  const status = item?.normalizedStatus || normalizeToolStatus(item?.status);
  const classification = item?.classification || classifyCommand(item?.command || "", { durationMs: item?.durationMs });
  const durationMs = item?.durationMs !== null && item?.durationMs !== undefined && item?.durationMs !== "" ? Number(item.durationMs) : NaN;
  if (status.kind !== "completed") return true;
  if (status.isActive || status.isFailure || status.kind === "cancelled") return true;
  if (item?.requiresApproval || item?.approvalRequired || item?.approval) return true;
  if (item?.continuousOutput || item?.hasContinuousOutput || options.continuousOutputIds?.has?.(item.id)) return true;
  if (Number.isFinite(durationMs) && durationMs >= (Number(options.longCommandMs) || 5000)) return true;
  if (["test", "build", "runner", "write"].includes(classification.category)) return true;
  if (!classification.groupable) return true;
  return false;
}

export function isGroupableReadonlyCommand(item, options = {}) {
  if (!isCommand(item)) return false;
  const status = item?.normalizedStatus || normalizeToolStatus(item?.status);
  if (status.kind !== "completed") return false;
  if (shouldKeepCommandStandalone(item, options)) return false;
  const classification = item?.classification || classifyCommand(item?.command || "", { durationMs: item?.durationMs });
  return classification.readonly && classification.groupable;
}

export function commandGroupId(turnId, firstItemId) {
  return `command-group:${String(turnId || "turn")}:${String(firstItemId || "item")}`;
}

function groupTitle(items) {
  const categories = new Set(items.map((entry) => entry.presentation.category));
  if (categories.has("search")) return "搜索项目代码";
  if (categories.has("read")) return "查看相关文件";
  return "检查现有实现";
}

function realDuration(items) {
  const values = items
    .map(({ item }) => item?.durationMs)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function appendCommandRun(blocks, run, turnId, options) {
  if (!run.length) return;
  if (run.length === 1) {
    blocks.push({ type: "command", turnId, item: run[0].item, presentation: run[0].presentation });
    return;
  }
  const maxVisible = Math.max(1, Number(options.maxVisibleGroupItems) || 5);
  const items = run.map(({ item, presentation }) => ({ item, presentation }));
  blocks.push({
    type: "commandGroup",
    id: commandGroupId(turnId, items[0].item.id),
    turnId,
    title: groupTitle(items),
    items,
    visibleItems: items.slice(0, maxVisible),
    hiddenCount: Math.max(0, items.length - maxVisible),
    durationMs: realDuration(items),
  });
}

export function buildConversationBlocks(turns, options = {}) {
  const blocks = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const turnId = turn?.id || null;
    let commandRun = [];
    const flush = () => {
      appendCommandRun(blocks, commandRun, turnId, options);
      commandRun = [];
    };
    for (const [index, rawItem] of (Array.isArray(turn?.items) ? turn.items : []).entries()) {
      const item = itemWithTurn(rawItem, turn, index);
      if (isCommand(item)) {
        const details = commandDetails(item, options);
        if (isGroupableReadonlyCommand({ ...item, normalizedStatus: details.presentation.normalizedStatus, classification: details.classification }, options)) {
          commandRun.push(details);
        } else {
          flush();
          blocks.push({ type: "command", turnId, item, presentation: details.presentation });
        }
        continue;
      }

      flush();
      if (item.type === "userMessage" || item.type === "agentMessage" || item.viewType === "message") {
        blocks.push({ type: "message", turnId, item, role: item.type === "userMessage" || item.role === "user" ? "user" : "assistant" });
      } else if (item.type === "fileChange" || item.viewType === "change") {
        blocks.push({ type: "fileChange", turnId, item });
      } else if (item.type === "mcpToolCall" || item.viewType === "mcp") {
        blocks.push({ type: "mcpTool", turnId, item });
      } else if (item.type === "error" || item.viewType === "error") {
        blocks.push({ type: "error", turnId, item });
      } else {
        blocks.push({ type: "status", turnId, item });
      }
    }
    flush();
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
