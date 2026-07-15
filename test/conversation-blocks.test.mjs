import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationBlocks,
  commandGroupId,
  isGroupableReadonlyCommand,
  mergeCachedTools,
  shouldKeepCommandStandalone,
} from "../public/conversation-blocks.js";

function command(id, value, status = "completed", extra = {}) {
  return { id, type: "commandExecution", command: value, status, ...extra };
}

test("groups only adjacent completed read-only commands with a stable id", () => {
  const blocks = buildConversationBlocks([{ id: "turn-1", items: [
    command("c1", "rg -n x ."),
    command("c2", "sed -n '1,20p' README.md"),
    { id: "answer", type: "agentMessage", text: "done" },
    command("c3", "pwd"),
  ]}]);
  assert.equal(blocks[0].type, "commandGroup");
  assert.equal(blocks[0].id, commandGroupId("turn-1", "c1"));
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].hiddenCount, 0);
  assert.equal(blocks[0].durationMs, null);
  assert.equal(blocks[1].type, "message");
  assert.equal(blocks[2].type, "command");
  assert.equal(isGroupableReadonlyCommand(command("c4", "cat file")), true);
});

test("keeps running, failed, writes, tests, and long commands standalone", () => {
  const blocks = buildConversationBlocks([{ id: "turn-2", items: [
    command("running", "rg x .", "running"),
    command("failed", "pytest -q", "failed", { aggregatedOutput: "FAILED test_x" }),
    command("write", "mkdir build"),
    command("long", "git status", "completed", { durationMs: 5000 }),
  ]}]);
  assert.deepEqual(blocks.map((block) => block.type), ["command", "command", "command", "command"]);
  assert.equal(shouldKeepCommandStandalone(command("running", "rg x .", "running")), true);
  assert.equal(shouldKeepCommandStandalone(command("long", "git status", "completed", { durationMs: 5000 })), true);
});

test("preserves file, MCP, and all group items in original order", () => {
  const items = [
    command("c1", "pwd"),
    command("c2", "ls", "completed"),
    { id: "change", type: "fileChange", status: "completed", changes: [] },
    command("c3", "cat package.json"),
    { id: "mcp", type: "mcpToolCall", server: "docs", tool: "search", status: "completed" },
  ];
  const blocks = buildConversationBlocks([{ id: "turn-3", items }]);
  assert.deepEqual(blocks.map((block) => block.type), ["commandGroup", "fileChange", "command", "mcpTool"]);
  assert.deepEqual(blocks[0].items.map(({ item }) => item.id), ["c1", "c2"]);
  assert.equal(blocks[1].item.id, "change");
  assert.equal(blocks[3].item.id, "mcp");
});

test("caps the group summary while retaining every expandable command", () => {
  const blocks = buildConversationBlocks([{ id: "turn-4", items: Array.from({ length: 7 }, (_, index) => command(`c${index}`, "pwd")) }]);
  assert.equal(blocks[0].type, "commandGroup");
  assert.equal(blocks[0].visibleItems.length, 5);
  assert.equal(blocks[0].hiddenCount, 2);
  assert.equal(blocks[0].items.length, 7);
});

test("merges cached tools after their previous item without mutating thread data", () => {
  const thread = { turns: [{ id: "turn-5", items: [
    { id: "user-1", type: "userMessage", content: [{ type: "text", text: "inspect" }] },
    { id: "answer-1", type: "agentMessage", text: "done" },
  ]}] };
  const restored = mergeCachedTools(thread, [{
    item: { id: "cached-command", type: "commandExecution", command: "pwd", status: "completed" },
    turnId: "turn-5",
    previousItemId: "user-1",
    sequence: 1,
  }]);
  assert.deepEqual(restored.turns[0].items.map((item) => item.id), ["user-1", "cached-command", "answer-1"]);
  assert.deepEqual(thread.turns[0].items.map((item) => item.id), ["user-1", "answer-1"]);
});
