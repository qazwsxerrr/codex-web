import test from "node:test";
import assert from "node:assert/strict";
import { extractMath, findStableMarkdownBoundary, renderMathSlots } from "../public/math-renderer.js";

test("extracts Codex math delimiters and preserves code", () => {
  const source = [
    String.raw`Inline \(a^2+b^2=c^2\).`,
    "",
    String.raw`\[`,
    String.raw`\min_x \|Ax-b\|_2^2`,
    String.raw`\]`,
    "",
    String.raw`$$\begin{bmatrix}1&2\\3&4\end{bmatrix}$$`,
    "",
    String.raw`Single dollar $E=mc^2$.`,
    "",
    "`\\[literal\\]`",
    "",
    "```python",
    'formula = "$$not_math$$"',
    "```",
  ].join("\n");

  const result = extractMath(source);
  assert.equal(result.formulas.length, 4);
  assert.equal(result.formulas.filter((item) => item.display).length, 2);
  assert.equal(result.formulas.filter((item) => !item.display).length, 2);
  assert.match(result.markdown, /\\\[literal\\\]/);
  assert.match(result.markdown, /\$\$not_math\$\$/);
  assert.match(result.markdown, /data-codex-math="0"/);
});

test("supports fenced math", () => {
  const result = extractMath("```math\n\\frac{1}{2}\n```");
  assert.equal(result.formulas.length, 1);
  assert.equal(result.formulas[0].display, true);
  assert.equal(result.formulas[0].tex, "\\frac{1}{2}");
});

test("only advances streaming Markdown at closed block boundaries", () => {
  const source = [
    "first block",
    "",
    "```text",
    String.raw`\[not math]`,
    "```",
    "",
    String.raw`\[x\]`,
    "",
    String.raw`\[unfinished`,
    "",
    "tail",
  ].join("\n");
  const first = source.indexOf("\n\n") + 2;
  const second = source.indexOf("\n\n", first) + 2;
  const third = source.indexOf("\n\n", second) + 2;
  assert.equal(findStableMarkdownBoundary(source), third);
  assert.equal(findStableMarkdownBoundary(source, first), third);
  assert.equal(findStableMarkdownBoundary(source, second), third);
  assert.equal(findStableMarkdownBoundary(source, third), third);
});

test("reuses cached KaTeX HTML without reparsing the formula", () => {
  let calls = 0;
  const slot = {
    dataset: { codexMath: "0" },
    classList: { add() {}, toggle() {} },
    set innerHTML(value) { this.html = value; },
  };
  const root = { querySelectorAll: () => [slot] };
  const katex = {
    renderToString(tex) {
      calls += 1;
      return `<span class="katex">${tex}</span>`;
    },
  };
  const formula = [{ tex: "x^2", display: false }];
  const cache = new Map();

  renderMathSlots(root, formula, katex, cache);
  renderMathSlots(root, formula, katex, cache);

  assert.equal(calls, 1);
  assert.match(slot.html, /class="katex"/);
});
