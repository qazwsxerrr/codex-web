import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThread, normalizeThreadItem } from "../public/thread-items.js";

const turn = { id: "turn-1", status: "completed", startedAt: 10, durationMs: 250 };

test("uses one adapter for restored and realtime thread items", () => {
  const user = { id: "u1", type: "userMessage", content: [{ type: "text", text: "hello" }, { type: "mention", name: "a.js", path: "a.js" }] };
  const realtime = normalizeThreadItem(user, turn);
  const restored = normalizeThread({ turns: [{ ...turn, items: [user, { id: "c1", type: "commandExecution", command: "pwd", cwd: "/tmp", status: "completed" }] }] });
  assert.deepEqual(restored.items[0], realtime);
  assert.equal(realtime.text, "hello\n@a.js");
  assert.equal(restored.commands[0].cwd, "/tmp");
  assert.equal(restored.latestTurn.startedAt, 10);
});
