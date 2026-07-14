import { displayInput } from "./composer-input.js";
import { normalizeFileChanges } from "./diff-data.js";

export function normalizeThreadItem(item, turn = {}) {
  if (!item || typeof item !== "object") return null;
  const base = { ...item, turnId: turn.id || null, turnStatus: turn.status || null, startedAt: turn.startedAt ?? null, turnDurationMs: turn.durationMs ?? null };
  if (item.type === "userMessage") return { ...base, viewType: "message", role: "user", text: displayInput(item.content || []) };
  if (item.type === "agentMessage") return { ...base, viewType: "message", role: "assistant", text: item.text || "" };
  if (item.type === "commandExecution") return { ...base, viewType: "command" };
  if (item.type === "fileChange") return { ...base, viewType: "change", files: normalizeFileChanges(item) };
  if (item.type === "mcpToolCall") return { ...base, viewType: "mcp" };
  if (item.type === "error") return { ...base, viewType: "error", text: item.message || item.error?.message || "Codex error" };
  return { ...base, viewType: "status" };
}

export function normalizeThread(thread) {
  const turns = (Array.isArray(thread?.turns) ? thread.turns : []).map((turn) => ({
    ...turn,
    items: (turn.items || []).map((item) => normalizeThreadItem(item, turn)).filter(Boolean),
  }));
  const items = turns.flatMap((turn) => turn.items);
  return {
    turns,
    items,
    commands: items.filter((item) => item.viewType === "command"),
    changes: items.filter((item) => item.viewType === "change"),
    latestTurn: turns.at(-1) || null,
  };
}

