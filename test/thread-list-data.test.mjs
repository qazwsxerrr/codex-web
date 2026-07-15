import assert from "node:assert/strict";
import test from "node:test";
import {
  filterThreads,
  formatThreadTime,
  groupThreads,
  mergeThreadPages,
  threadGroup,
  threadTitle,
} from "../public/thread-list-data.js";

function at(year, month, day, hour = 12, minute = 0) {
  return Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000);
}

test("uses thread name, then first-user-message preview for titles", () => {
  assert.equal(threadTitle({ name: "  Named   thread ", preview: "ignored" }), "Named thread");
  assert.equal(threadTitle({ name: null, preview: "  First user\nmessage  " }), "First user message");
  assert.equal(threadTitle({}), "Untitled conversation");
  assert.equal(threadTitle({ preview: "1234567890" }, 8), "12345...");
});

test("groups recent threads by local calendar boundaries", () => {
  const now = new Date(2026, 6, 13, 18, 0); // Monday
  assert.equal(threadGroup({ recencyAt: at(2026, 7, 13, 8) }, now), "today");
  assert.equal(threadGroup({ recencyAt: at(2026, 7, 12, 8) }, now), "yesterday");
  assert.equal(threadGroup({ recencyAt: at(2026, 7, 11, 8) }, now), "earlier");

  const thursday = new Date(2026, 6, 16, 18, 0);
  assert.equal(threadGroup({ recencyAt: at(2026, 7, 14, 8) }, thursday), "thisWeek");
  assert.deepEqual(
    groupThreads([
      { id: "today", recencyAt: at(2026, 7, 16) },
      { id: "week", recencyAt: at(2026, 7, 14) },
    ], thursday).map((group) => group.label),
    ["Today", "This Week"],
  );
});

test("filters title, preview, and cwd without case sensitivity", () => {
  const threads = [
    { id: "1", name: "Formula rendering", preview: "KaTeX", cwd: "/work/math" },
    { id: "2", preview: "Fix MCP status", cwd: "/work/codex" },
  ];
  assert.deepEqual(filterThreads(threads, "katex").map((thread) => thread.id), ["1"]);
  assert.deepEqual(filterThreads(threads, "CODEX").map((thread) => thread.id), ["2"]);
  assert.equal(filterThreads(threads, "").length, 2);
});

test("merges paged thread results by id and keeps recency order", () => {
  const merged = mergeThreadPages(
    [{ id: "a", recencyAt: 10, preview: "old" }],
    [{ id: "b", recencyAt: 20 }, { id: "a", recencyAt: 30, preview: "new" }],
  );
  assert.deepEqual(merged.map((thread) => thread.id), ["a", "b"]);
  assert.equal(merged[0].preview, "new");
  assert.match(formatThreadTime(merged[0], new Date(30_000)), /\d/);
});
