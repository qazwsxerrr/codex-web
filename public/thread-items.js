import { displayInput } from "./composer-input.js";
import { normalizeFileChanges } from "./diff-data.js";
import { reasoningText } from "./protocol-text.js";

export function normalizeThreadItem(item, turn = {}) {
  if (!item || typeof item !== "object") return null;
  const base = { ...item, turnId: turn.id || null, turnStatus: turn.status || null, startedAt: turn.startedAt ?? null, turnDurationMs: turn.durationMs ?? null };
  if (item.type === "userMessage") return { ...base, viewType: "message", role: "user", text: displayInput(item.content || []) };
  if (item.type === "agentMessage") return { ...base, viewType: "message", role: "assistant", text: item.text || "" };
  if (item.type === "commandExecution") return { ...base, viewType: "command" };
  if (item.type === "fileChange") return { ...base, viewType: "change", files: normalizeFileChanges(item) };
  if (item.type === "mcpToolCall") return { ...base, viewType: "mcp" };
  if (item.type === "dynamicToolCall") return { ...base, viewType: "dynamicTool" };
  if (["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(item.type)) return { ...base, viewType: "agent" };
  if (["imageView", "imageGeneration"].includes(item.type)) return { ...base, viewType: "imageView" };
  if (["hookPrompt", "sleep"].includes(item.type)) {
    const hookText = Array.isArray(item.fragments)
      ? item.fragments.map((fragment) => fragment?.text || "").filter(Boolean).join("\n\n")
      : "";
    return { ...base, viewType: "status", text: item.text || item.message || hookText || item.type };
  }
  if (item.type === "contextCompaction") return { ...base, viewType: "compaction" };
  if (["enteredReviewMode", "exitedReviewMode", "review"].includes(item.type)) return { ...base, viewType: "review" };
  if (item.type === "webSearch") return { ...base, viewType: "search" };
  if (item.type === "plan") return { ...base, viewType: "plan", planText: item.text || "" };
  if (["reasoning", "thinking"].includes(item.type)) return { ...base, viewType: "reasoning", text: reasoningText(item) };
  if (item.type === "error") return { ...base, viewType: "error", text: item.message || item.error?.message || "Codex error" };
  return { ...base, viewType: "unknown", unknownType: item.type || "unknown" };
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
