import assert from "node:assert/strict";
import test from "node:test";
import { composeUserInput, makeMention, validateImage } from "../public/composer-input.js";

test("builds native text, mention, and image UserInput", () => {
  const result = composeUserInput(
    "Inspect this",
    [{ file_name: "app.js", path: "public/app.js" }],
    [{ url: "data:image/png;base64,AA==" }],
  );
  assert.deepEqual(result, [
    { type: "text", text: "Inspect this" },
    { type: "mention", name: "app.js", path: "public/app.js" },
    { type: "image", url: "data:image/png;base64,AA==" },
  ]);
  assert.deepEqual(makeMention({ path: "src/index.mjs" }), { type: "mention", name: "index.mjs", path: "src/index.mjs" });
});
test("rejects unsupported or oversized image attachments", () => {
  assert.throws(() => validateImage({ type: "text/plain", size: 1 }), /Only image/);
  assert.throws(() => validateImage({ type: "image/png", size: 10 * 1024 * 1024 + 1 }), /10 MB/);
  assert.throws(() => composeUserInput("", [], Array.from({ length: 5 }, () => "data:image/png;base64,AA==")), /at most 4/);
});
