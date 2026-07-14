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

export function renderMathSlots(root, formulas, katex) {
  const slots = root.querySelectorAll("[data-codex-math]");
  for (const slot of slots) {
    const index = Number(slot.dataset.codexMath);
    const formula = formulas[index];
    if (!formula) continue;
    try {
      katex.render(formula.tex, slot, {
        displayMode: formula.display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      });
    } catch (error) {
      slot.classList.add("math-error");
      slot.textContent = formula.tex;
      slot.title = error.message;
    }
  }
}
