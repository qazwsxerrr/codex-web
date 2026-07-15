import assert from "node:assert/strict";
import test from "node:test";
import { guardianEventFromNotification, prioritizeSlashMatches, resolveSlashSelection } from "../public/slash-input.js";

test("Enter executes the highlighted complete command instead of partial /s", () => {
  assert.deepEqual(
    resolveSlashSelection("/s", { name: "/status" }, "enter"),
    { kind: "submit", value: "/status" },
  );
});

test("ranks /status first for the ambiguous /s query", () => {
  const matches = prioritizeSlashMatches("/s", [
    { name: "/setup-default-sandbox" },
    { name: "/skills" },
    { name: "/status" },
    { name: "/stop" },
  ]);
  assert.equal(matches[0].name, "/status");
});

test("Enter preserves inline arguments", () => {
  assert.deepEqual(
    resolveSlashSelection("/mcp verbose", { name: "/mcp" }, "enter"),
    { kind: "submit", value: "/mcp verbose" },
  );
});

test("commands that require arguments autocomplete instead of executing empty", () => {
  assert.deepEqual(
    resolveSlashSelection("/r", { name: "/rename", requiresArgs: true }, "enter"),
    { kind: "fill", value: "/rename " },
  );
});

test("converts a guardian denial notification to the CLI retry event", () => {
  assert.deepEqual(guardianEventFromNotification({
    reviewId: "review-1",
    turnId: "turn-1",
    targetItemId: "item-1",
    startedAtMs: 10,
    completedAtMs: 20,
    decisionSource: "agent",
    action: { type: "command", command: "pwd", cwd: "/tmp", source: "shell" },
    review: {
      status: "denied",
      riskLevel: "high",
      userAuthorization: "low",
      rationale: "needs approval",
    },
  }), {
    id: "review-1",
    targetItemId: "item-1",
    turnId: "turn-1",
    startedAtMs: 10,
    completedAtMs: 20,
    status: "denied",
    riskLevel: "high",
    userAuthorization: "low",
    rationale: "needs approval",
    decisionSource: "agent",
    action: { type: "command", command: "pwd", cwd: "/tmp", source: "shell" },
  });
});
