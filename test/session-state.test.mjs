import assert from "node:assert/strict";
import test from "node:test";
import { createSessionSettings, navigateThread, pushThreadNavigation, resolveReasoningEffort, shouldFollowScroll } from "../public/session-state.js";

test("synchronizes session settings from the current thread", () => {
  assert.deepEqual(createSessionSettings({ model: "gpt-5", reasoningEffort: "high", cwd: "/work", activePermissionProfile: { id: "full" } }, { serviceTier: "fast" }), {
    model: "gpt-5", reasoningEffort: "high", permissions: "full", serviceTier: "fast", cwd: "/work",
  });
});

test("prefers the current selected effort over stale thread metadata for display", () => {
  assert.equal(resolveReasoningEffort({ reasoningEffort: "high", effort: "max" }, "max"), "max");
  assert.equal(resolveReasoningEffort({ reasoningEffort: "max" }, ""), "max");
  assert.equal(resolveReasoningEffort({ settings: { reasoning_effort: "max" } }, ""), "max");
});

test("maintains browser-local thread back and forward navigation", () => {
  let navigation = pushThreadNavigation({ items: [], index: -1 }, "a");
  navigation = pushThreadNavigation(navigation, "b");
  const back = navigateThread(navigation, -1);
  assert.equal(back.threadId, "a");
  assert.equal(navigateThread({ items: back.items, index: back.index }, 1).threadId, "b");
});

test("follows output only while near the bottom", () => {
  assert.equal(shouldFollowScroll({ scrollTop: 850, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(shouldFollowScroll({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 }), false);
});
