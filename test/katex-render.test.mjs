import test from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { extractMath } from "../public/math-renderer.js";

test("renders Codex delimiters with KaTeX", () => {
  const source = String.raw`Inline \(\phi(z)=\sum_{n=0}^{\infty}a_nz^n\)

\[
\mathbf K=\begin{bmatrix}1&2\\3&4\end{bmatrix}
\]`;
  const result = extractMath(source);
  assert.equal(result.formulas.length, 2);
  for (const formula of result.formulas) {
    const html = katex.renderToString(formula.tex, {
      displayMode: formula.display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
    });
    assert.match(html, /class="katex/);
  }
});
