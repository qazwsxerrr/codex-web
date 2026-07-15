const MATH_FENCE_RE = /```math[ \t]*\n([\s\S]*?)```/gi;
const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /(`+)([^`]|`(?!\1))*?\1/g;

function placeholder(kind, index) {
  return `CODEX${kind}PLACEHOLDER${index}TOKEN`;
}

function maskWithRegex(text, regex, storage, kind) {
  return text.replace(regex, (match) => {
    const index = storage.push(match) - 1;
    return placeholder(kind, index);
  });
}

function restorePlaceholders(text, storage, kind) {
  let output = text;
  storage.forEach((value, index) => {
    output = output.replaceAll(placeholder(kind, index), () => value);
  });
  return output;
}

export function extractMath(markdown) {
  const formulas = [];
  const codeSegments = [];
  let text = String(markdown ?? "");

  function addFormula(tex, display) {
    const index = formulas.push({ tex: String(tex).trim(), display }) - 1;
    const tag = display ? "div" : "span";
    const spacing = display ? "\n\n" : "";
    return `${spacing}<${tag} class="math-slot" data-codex-math="${index}"></${tag}>${spacing}`;
  }

  text = text.replace(MATH_FENCE_RE, (_match, tex) => addFormula(tex, true));
  text = maskWithRegex(text, CODE_FENCE_RE, codeSegments, "CODE");
  text = maskWithRegex(text, INLINE_CODE_RE, codeSegments, "CODE");

  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, tex) => addFormula(tex, true));
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, tex) => addFormula(tex, true));
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_match, tex) => addFormula(tex, false));

  text = text.replace(/(^|[^\\$])\$([^\n$]*?\S)\$(?!\$)/g, (_match, prefix, tex) => {
    return `${prefix}${addFormula(tex, false)}`;
  });

  text = restorePlaceholders(text, codeSegments, "CODE");
  return { markdown: text, formulas };
}

function advanceStreamSyntax(state, line) {
  const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
  if (fenceMatch) {
    const marker = fenceMatch[1][0];
    if (!state.fence) state.fence = marker;
    else if (state.fence === marker) state.fence = null;
    return;
  }
  if (state.fence) return;

  const source = line.replace(/`+[^`]*`+/g, "");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\" && source[index + 1] === "[") {
      if (state.math === "display-bracket") state.math = null;
      else if (!state.math) state.math = "display-bracket";
      index += 1;
    } else if (source[index] === "\\" && source[index + 1] === "]") {
      if (state.math === "display-bracket") state.math = null;
      index += 1;
    } else if (source[index] === "\\" && source[index + 1] === "(") {
      if (state.math === "inline-bracket") state.math = null;
      else if (!state.math) state.math = "inline-bracket";
      index += 1;
    } else if (source[index] === "\\" && source[index + 1] === ")") {
      if (state.math === "inline-bracket") state.math = null;
      index += 1;
    } else if (source[index] === "$" && source[index - 1] !== "\\") {
      const display = source[index + 1] === "$";
      if (display) index += 1;
      if (state.math === (display ? "display-dollar" : "inline-dollar")) state.math = null;
      else if (!state.math) state.math = display ? "display-dollar" : "inline-dollar";
    }
  }
}

export function findStableMarkdownBoundary(markdown, fromIndex = 0) {
  const text = String(markdown ?? "");
  const start = Math.max(0, Number(fromIndex) || 0);
  const state = { fence: null, math: null };
  let stableEnd = start;
  const lines = /([^\r\n]*)(\r?\n|$)/g;
  let match;
  while ((match = lines.exec(text))) {
    advanceStreamSyntax(state, match[1]);
    const end = lines.lastIndex;
    if (match[2] && match[1] === "" && end > start && !state.fence && !state.math) stableEnd = end;
    if (!match[2]) break;
  }

  return stableEnd;
}

function cacheMathHtml(cache, key, html) {
  if (!(cache instanceof Map)) return;
  if (cache.size >= 512 && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, html);
}

function normalizeCachedMathHtml(html, display) {
  if (!display) return { html, display: false };
  const match = String(html).match(/^<span class="katex-display">([\s\S]*)<\/span>$/);
  return { html: match?.[1] || html, display: true };
}

function applyCachedMathHtml(slot, cached) {
  slot.classList.toggle("katex-display", Boolean(cached.display));
  slot.innerHTML = cached.html;
}

export function renderMathSlots(root, formulas, katex, cache = null) {
  const slots = root.querySelectorAll("[data-codex-math]");
  for (const slot of slots) {
    const index = Number(slot.dataset.codexMath);
    const formula = formulas[index];
    if (!formula) continue;
    try {
      const key = `${formula.display ? "display" : "inline"}\u0000${formula.tex}`;
      const cached = cache instanceof Map ? cache.get(key) : undefined;
      if (cached !== undefined) {
        applyCachedMathHtml(slot, cached);
        continue;
      }
      const options = {
        displayMode: formula.display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      };
      if (cache instanceof Map && typeof katex.renderToString === "function") {
        // KaTeX owns this generated HTML and trust=false keeps input commands non-executable.
        const html = normalizeCachedMathHtml(katex.renderToString(formula.tex, options), formula.display);
        cacheMathHtml(cache, key, html);
        applyCachedMathHtml(slot, html);
      } else {
        katex.render(formula.tex, slot, options);
      }
    } catch (error) {
      slot.classList.add("math-error");
      slot.textContent = formula.tex;
      slot.title = error.message;
    }
  }
}
