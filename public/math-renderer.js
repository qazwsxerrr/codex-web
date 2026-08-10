const MATH_FENCE_RE = /```math[ \t]*\n([\s\S]*?)```/gi;
const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /(`+)([^`]|`(?!\1))*?\1/g;
const DEFAULT_CACHE_LIMIT = 512;
const DEFAULT_FRAME_BUDGET_MS = 6;

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

function createSyntaxState() {
  return {
    fence: null,
    inlineCode: 0,
    math: null,
  };
}

function countRun(source, start, character) {
  let end = start;
  while (source[end] === character) end += 1;
  return end - start;
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function fenceAtLineStart(line) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})/);
  if (!match) return null;
  return { character: match[1][0], length: match[1].length };
}

function advanceMathSyntax(state, line) {
  const fence = !state.inlineCode ? fenceAtLineStart(line) : null;
  if (state.fence) {
    if (fence && fence.character === state.fence.character && fence.length >= state.fence.length) {
      state.fence = null;
    }
    return;
  }
  if (fence) {
    state.fence = fence;
    return;
  }

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (state.inlineCode) {
      if (character === "`") {
        const length = countRun(line, index, "`");
        if (length === state.inlineCode) state.inlineCode = 0;
        index += length - 1;
      }
      continue;
    }
    if (state.math) {
      if (state.math === "display-bracket" && !isEscaped(line, index) && line.startsWith("\\]", index)) {
        state.math = null;
        index += 1;
      } else if (state.math === "inline-bracket" && !isEscaped(line, index) && line.startsWith("\\)", index)) {
        state.math = null;
        index += 1;
      } else if (state.math === "display-dollar" && !isEscaped(line, index) && line.startsWith("$$", index)) {
        state.math = null;
        index += 1;
      } else if (state.math === "inline-dollar" && character === "$" && !isEscaped(line, index)) {
        state.math = null;
        if (line[index + 1] === "$") index += 1;
      } else if (character === "\\") {
        index += 1;
      }
      continue;
    }

    if (character === "`") {
      const length = countRun(line, index, "`");
      state.inlineCode = length;
      index += length - 1;
      continue;
    }
    if (character === "\\" && !isEscaped(line, index)) {
      const next = line[index + 1];
      if (next === "[" || next === "]") {
        if (next === "[") state.math = "display-bracket";
        index += 1;
      } else if (next === "(" || next === ")") {
        if (next === "(") state.math = "inline-bracket";
        index += 1;
      }
      continue;
    }
    if (character !== "$" || isEscaped(line, index)) continue;
    if (line[index + 1] === "$") {
      state.math = "display-dollar";
      index += 1;
    } else {
      state.math = "inline-dollar";
    }
  }

}

function advanceStreamSyntax(state, line) {
  advanceMathSyntax(state, line);
}

function clampOffset(text, fromIndex) {
  const numeric = Number(fromIndex);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(text.length, Math.max(0, Math.floor(numeric)));
}

/**
 * Return the end of the last blank-line boundary whose syntax is complete.
 * `fromIndex` must be an offset previously returned by this function (or 0).
 * This lets streaming callers scan only the newly appended suffix.
 */
export function findStableMarkdownBoundary(markdown, fromIndex = 0) {
  const text = String(markdown ?? "");
  const start = clampOffset(text, fromIndex);
  const state = createSyntaxState();
  let stableEnd = start;
  let lineStart = start;

  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const hasNewline = newline >= 0;
    const lineEnd = hasNewline ? newline : text.length;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    advanceStreamSyntax(state, line);
    const end = hasNewline ? newline + 1 : text.length;
    if (hasNewline && line === "" && !state.fence && !state.math && !state.inlineCode && end > start) {
      stableEnd = end;
    }
    if (!hasNewline) break;
    lineStart = newline + 1;
  }

  return stableEnd;
}

/**
 * Small state holder for streaming Markdown. `scan(markdown)` returns the new
 * stable offset; callers can append to the same string and scan again without
 * reparsing its already committed prefix.
 */
export function createStableMarkdownScanner(initialOffset = 0) {
  let committedOffset = Math.max(0, Math.floor(Number(initialOffset) || 0));
  let committedPrefix = "";
  return {
    get offset() {
      return committedOffset;
    },
    get committedOffset() {
      return committedOffset;
    },
    reset(offset = 0) {
      committedOffset = Math.max(0, Math.floor(Number(offset) || 0));
      committedPrefix = "";
      return committedOffset;
    },
    scan(markdown, fromIndex = committedOffset) {
      const text = String(markdown ?? "");
      let requested = clampOffset(text, fromIndex);
      if (fromIndex === committedOffset && committedPrefix && !text.startsWith(committedPrefix)) {
        requested = 0;
      }
      committedOffset = findStableMarkdownBoundary(text, requested);
      committedPrefix = text.slice(0, committedOffset);
      return committedOffset;
    },
  };
}

export const createMarkdownBoundaryScanner = createStableMarkdownScanner;

function cacheLimit(cache) {
  const value = Number(cache?.maxEntries ?? cache?.capacity ?? DEFAULT_CACHE_LIMIT);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_CACHE_LIMIT;
}

class MathRenderCache extends Map {
  constructor(maxEntries) {
    super();
    const numeric = Number(maxEntries);
    this.maxEntries = Number.isFinite(numeric)
      ? Math.max(0, Math.floor(numeric))
      : DEFAULT_CACHE_LIMIT;
  }

  get(key) {
    if (!super.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value);
    return value;
  }

  set(key, value) {
    const limit = cacheLimit(this);
    if (limit <= 0) return this;
    if (super.has(key)) super.delete(key);
    while (super.size >= limit) super.delete(super.keys().next().value);
    super.set(key, value);
    return this;
  }
}

/** Create a Map-compatible true LRU cache for rendered KaTeX HTML. */
export function createMathRenderCache(maxEntries = DEFAULT_CACHE_LIMIT) {
  return new MathRenderCache(maxEntries);
}

function getCachedMathHtml(cache, key) {
  if (!(cache instanceof Map) || !cache.has(key)) return undefined;
  const html = cache.get(key);
  // Map insertion order is used as the recency order.
  cache.delete(key);
  cache.set(key, html);
  return html;
}

function cacheMathHtml(cache, key, html) {
  if (!(cache instanceof Map)) return;
  const limit = cacheLimit(cache);
  if (limit <= 0) return;
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, html);
}

function normalizeCachedMathHtml(html, display) {
  const match = String(html).match(/^<span class="katex-display">([\s\S]*)<\/span>$/);
  return { html: match?.[1] || String(html), display: Boolean(display) };
}

function removeClass(slot, className) {
  if (typeof slot.classList?.remove === "function") slot.classList.remove(className);
}

function clearMathError(slot) {
  removeClass(slot, "math-error");
  if (typeof slot.removeAttribute === "function") slot.removeAttribute("title");
  else if ("title" in slot) slot.title = "";
}

function applyCachedMathHtml(slot, cached) {
  clearMathError(slot);
  slot.classList.toggle("katex-display", Boolean(cached.display));
  slot.innerHTML = cached.html;
}

function renderMathSlot(slot, formula, katex, cache = null) {
  const key = `${formula.display ? "display" : "inline"}\u0000${formula.tex}`;
  const cached = getCachedMathHtml(cache, key);
  if (cached !== undefined) {
    applyCachedMathHtml(slot, cached);
    return;
  }

  const options = {
    displayMode: formula.display,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
  };
  try {
    if (cache instanceof Map && typeof katex.renderToString === "function") {
      // KaTeX owns this generated HTML and trust=false keeps input commands non-executable.
      const html = normalizeCachedMathHtml(katex.renderToString(formula.tex, options), formula.display);
      cacheMathHtml(cache, key, html);
      applyCachedMathHtml(slot, html);
    } else {
      katex.render(formula.tex, slot, options);
      clearMathError(slot);
    }
  } catch (error) {
    slot.classList.add("math-error");
    slot.textContent = formula.tex;
    slot.title = error?.message || String(error);
  }
}

export function renderMathSlots(root, formulas, katex, cache = null) {
  const slots = root.querySelectorAll("[data-codex-math]");
  for (const slot of slots) {
    const index = Number(slot.dataset.codexMath);
    const formula = formulas[index];
    if (!formula) continue;
    renderMathSlot(slot, formula, katex, cache);
  }
}

function defaultNow() {
  if (typeof globalThis.performance?.now === "function") return globalThis.performance.now();
  return Date.now();
}

function defaultRequestFrame(callback, now) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(now()), 0);
}

function defaultCancelFrame(frameId) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(frameId);
  else globalThis.clearTimeout(frameId);
}

/**
 * Render math slots over animation frames.
 *
 * Returns `{ promise, cancel, signal }`; `promise` resolves to
 * `{ cancelled, completed, total, remaining }`. `options` accepts
 * `budgetMs`/`frameBudgetMs` (default 6), `requestFrame`, `cancelFrame`,
 * `now`, `signal`, and `onProgress` for deterministic integration/tests.
 */
export function scheduleMathSlots(root, formulas, katex, cache = null, options = {}) {
  const settings = options && Object.keys(options).length ? options : (
    cache && !(cache instanceof Map) && typeof cache === "object" ? cache : {}
  );
  if (settings === cache) cache = settings.cache || null;
  const slots = [...root.querySelectorAll("[data-codex-math]")];
  const total = slots.reduce((count, slot) => {
    const index = Number(slot.dataset.codexMath);
    return formulas[index] ? count + 1 : count;
  }, 0);
  const budget = Math.max(0, Number(settings.frameBudgetMs ?? settings.budgetMs ?? DEFAULT_FRAME_BUDGET_MS) || 0);
  const now = typeof settings.now === "function" ? settings.now : defaultNow;
  const requestFrame = typeof settings.requestFrame === "function"
    ? settings.requestFrame
    : (callback) => defaultRequestFrame(callback, now);
  const cancelFrame = typeof settings.cancelFrame === "function" ? settings.cancelFrame : defaultCancelFrame;
  const signal = settings.signal || null;
  let frameId = null;
  let cursor = 0;
  let completed = 0;
  let cancelled = false;
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function finish(wasCancelled) {
    if (settled) return;
    settled = true;
    cancelled = cancelled || wasCancelled;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    signal?.removeEventListener?.("abort", cancel);
    const remaining = total - completed;
    resolvePromise({ cancelled, completed, total, remaining });
  }

  function cancel() {
    if (settled) return;
    cancelled = true;
    finish(true);
  }

  function frame() {
    frameId = null;
    if (settled || cancelled) return finish(true);
    const started = now();
    let processed = 0;
    try {
      while (cursor < slots.length) {
        const slot = slots[cursor];
        cursor += 1;
        const formula = formulas[Number(slot.dataset.codexMath)];
        if (!formula) continue;
        renderMathSlot(slot, formula, katex, cache);
        completed += 1;
        processed += 1;
        if (processed > 0 && now() - started >= budget) break;
      }
    } catch (error) {
      settled = true;
      rejectPromise(error);
      return;
    }

    settings.onProgress?.({ completed, total, remaining: total - completed });
    if (cancelled) return finish(true);
    if (cursor >= slots.length) return finish(false);
    frameId = requestFrame(frame);
  }

  const handle = {
    promise,
    cancel,
    signal,
    get cancelled() {
      return cancelled;
    },
  };
  signal?.addEventListener?.("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  else frameId = requestFrame(frame);
  return handle;
}

export const renderMathSlotsProgressively = scheduleMathSlots;
