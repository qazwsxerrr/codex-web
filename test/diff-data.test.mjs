import assert from "node:assert/strict";
import test from "node:test";
import { diffRowMarker, normalizeFileChanges, parseUnifiedDiff, selectDiffPreviewRows, visibleDiffRows } from "../public/diff-data.js";

test("assigns visible markers to diff row types", () => {
  assert.equal(diffRowMarker("addition"), "+");
  assert.equal(diffRowMarker("deletion"), "-");
  assert.equal(diffRowMarker("hunk"), "@");
  assert.equal(diffRowMarker("context"), "");
});

test("parses multiple hunks, line numbers, notices, and statistics", () => {
  const parsed = parseUnifiedDiff([
    "diff --git a/a.js b/a.js",
    "--- a/a.js",
    "+++ b/a.js",
    "@@ -2,3 +2,3 @@",
    " same",
    "-old",
    "+new",
    "@@ -20 +20,2 @@",
    "-gone",
    "+<tag>",
    "+next",
    "\\ No newline at end of file",
  ].join("\n"));
  assert.equal(parsed.additions, 3);
  assert.equal(parsed.deletions, 2);
  assert.deepEqual(parsed.rows.find((row) => row.text === "+<tag>"), {
    index: 9, type: "addition", text: "+<tag>", oldLine: null, newLine: 20,
  });
  assert.equal(parsed.rows.at(-1).type, "notice");
});

test("normalizes nested paths and never stringifies objects", () => {
  const [file] = normalizeFileChanges({
    changes: [{ path: [{ path: { value: "src/app.js" } }], kind: { type: "update" }, diff: "@@ -1 +1 @@\n-a\n+b" }],
  });
  assert.equal(file.path, "src/app.js");
  assert.equal(file.kind, "update");
  assert.doesNotMatch(file.path, /\[object Object\]/);
  assert.doesNotMatch(file.kind, /\[object Object\]/);
  assert.equal(file.additions, 1);
  assert.equal(file.deletions, 1);
});

test("counts raw new-file contents as additions", () => {
  const [file] = normalizeFileChanges({
    changes: [{
      path: "angle_detector/cond_A/sketch.py",
      kind: { type: "add" },
      diff: "from __future__ import annotations\n\nimport numpy as np\n",
    }],
  });
  assert.equal(file.kind, "add");
  assert.equal(file.additions, 3);
  assert.equal(file.deletions, 0);
  assert.deepEqual(file.rows.map((row) => [row.type, row.newLine, row.text]), [
    ["addition", 1, "+from __future__ import annotations"],
    ["addition", 2, "+"],
    ["addition", 3, "+import numpy as np"],
  ]);
});

test("splits turn-level file diffs and supports large-file paging", () => {
  const source = [
    "diff --git a/old.js b/new.js\nsimilarity index 90%\nrename from old.js\nrename to new.js\n--- a/old.js\n+++ b/new.js\n@@ -1 +1 @@\n-old\n+new",
    "diff --git a/add.js b/add.js\nnew file mode 100644\n--- /dev/null\n+++ b/add.js\n@@ -0,0 +1 @@\n+added",
  ].join("\n");
  const files = normalizeFileChanges([], source);
  assert.deepEqual(files.map((file) => file.path), ["new.js", "add.js"]);
  assert.equal(files[1].kind, "add");

  const rows = Array.from({ length: 1_000 }, (_, index) => ({ index }));
  assert.equal(visibleDiffRows(rows, 1).rows.length, 400);
  assert.equal(visibleDiffRows(rows, 2).rows.length, 800);
  assert.equal(visibleDiffRows(rows, 3).hasMore, false);
});

test("selects a compact diff preview around additions and deletions", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    type: index === 20 ? "addition" : "context",
    text: ` ${index}`,
  }));
  const preview = selectDiffPreviewRows(rows, { limit: 12, context: 2 });
  assert.equal(preview.length, 12);
  assert.ok(preview.some((row) => row.type === "addition"));
  assert.ok(preview.some((row) => row.text === " 18"));
});
