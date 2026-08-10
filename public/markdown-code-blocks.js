const DEFAULT_LANGUAGE = "text";
const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const COPY_FAILED_LABEL = "Copy failed";
const COPY_FEEDBACK_MS = 1500;

function resolveDocument(root, providedDocument) {
  return providedDocument || root?.ownerDocument || globalThis.document || null;
}

function languageClassName(code) {
  if (!code) return "";
  const className = code.getAttribute?.("class") ?? code.className ?? "";
  if (typeof className === "string") return className;
  return String(className?.baseVal || "");
}

export function normalizeCodeLanguage(className) {
  const token = String(className || "")
    .split(/\s+/)
    .find((value) => /^language-/i.test(value));
  const language = token ? token.slice("language-".length).trim() : "";
  return (language || DEFAULT_LANGUAGE).toLowerCase();
}

export function normalizeCodeForCopy(value) {
  const text = String(value ?? "");
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n") || text.endsWith("\r")) return text.slice(0, -1);
  return text;
}

function setButtonLabel(button, label, state) {
  const labelNode = button.querySelector?.(".markdown-code-copy-label");
  if (labelNode) labelNode.textContent = label;
  else button.textContent = label;
  button.dataset.copyState = state;
  button.setAttribute("aria-label", state === "copied" ? "Copied" : state === "failed" ? COPY_FAILED_LABEL : "Copy code");
  button.title = state === "failed" ? COPY_FAILED_LABEL : state === "copied" ? "Copied" : "Copy code";
}

function copyWithTextarea(value, document) {
  if (!document?.createElement) return false;
  const host = document.body || document.documentElement;
  if (!host?.appendChild) return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.textContent = value;
  textarea.setAttribute?.("readonly", "");
  textarea.setAttribute?.("aria-hidden", "true");
  if (textarea.style) {
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
  }

  host.appendChild(textarea);
  try {
    textarea.focus?.();
    textarea.select?.();
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove?.();
    if (textarea.parentNode?.removeChild) textarea.parentNode.removeChild(textarea);
  }
}

export async function copyCodeText(value, { clipboard = null, document = null } = {}) {
  const text = String(value ?? "");
  const targetDocument = document || globalThis.document || null;
  let clipboardTarget = clipboard;
  if (!clipboardTarget) {
    try {
      clipboardTarget = globalThis.navigator?.clipboard || null;
    } catch {
      clipboardTarget = null;
    }
  }

  if (typeof clipboardTarget?.writeText === "function") {
    try {
      await clipboardTarget.writeText(text);
      return true;
    } catch {
      // Fall through to the browser-compatible textarea path.
    }
  }

  try {
    return copyWithTextarea(text, targetDocument);
  } catch {
    return false;
  }
}

function createCopyButton(document, code, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "markdown-code-copy text-button";
  button.title = "Copy code";
  button.setAttribute("aria-label", "Copy code");

  const icon = document.createElement("i");
  icon.dataset.icon = "copy";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "markdown-code-copy-label";
  label.textContent = COPY_LABEL;
  button.append(icon, label);

  let attempt = 0;
  let timer = null;
  const schedule = options.setTimeout || globalThis.setTimeout;
  const clear = options.clearTimeout || globalThis.clearTimeout;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const currentAttempt = ++attempt;
    if (timer !== null) clear?.(timer);
    timer = null;
    const value = normalizeCodeForCopy(code.textContent || "");
    void copyCodeText(value, { clipboard: options.clipboard, document }).then((copied) => {
      if (currentAttempt !== attempt) return;
      if (!copied) {
        setButtonLabel(button, COPY_FAILED_LABEL, "failed");
        return;
      }
      setButtonLabel(button, COPIED_LABEL, "copied");
      if (typeof schedule === "function") {
        timer = schedule(() => {
          timer = null;
          if (currentAttempt === attempt) setButtonLabel(button, COPY_LABEL, "idle");
        }, options.feedbackMs ?? COPY_FEEDBACK_MS);
      }
    }).catch(() => {
      if (currentAttempt === attempt) setButtonLabel(button, COPY_FAILED_LABEL, "failed");
    });
  });
  return button;
}

function isEnhancedCodeBlock(pre) {
  const wrapper = pre?.parentElement || pre?.parentNode;
  return Boolean(wrapper?.dataset?.markdownCodeBlock === "true" || wrapper?.classList?.contains?.("markdown-code-block"));
}

export function enhanceMarkdownCodeBlocks(root, options = {}) {
  if (!root?.querySelectorAll) return [];
  const document = resolveDocument(root, options.document);
  if (!document?.createElement) return [];

  const enhanced = [];
  for (const code of [...root.querySelectorAll("pre > code")]) {
    const pre = code.parentElement || code.parentNode;
    if (!pre || isEnhancedCodeBlock(pre)) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "markdown-code-block";
    wrapper.dataset.markdownCodeBlock = "true";
    const parent = pre.parentNode;

    const header = document.createElement("div");
    header.className = "markdown-code-header";
    const language = document.createElement("span");
    language.className = "markdown-code-language";
    language.textContent = normalizeCodeLanguage(languageClassName(code));
    const copy = createCopyButton(document, code, options);
    header.append(language, copy);

    if (parent?.replaceChild) parent.replaceChild(wrapper, pre);
    else if (pre.replaceWith) pre.replaceWith(wrapper);
    else continue;
    wrapper.append(header, pre);
    enhanced.push(wrapper);
  }
  return enhanced;
}

export const markdownCodeBlockLabels = Object.freeze({
  copy: COPY_LABEL,
  copied: COPIED_LABEL,
  failed: COPY_FAILED_LABEL,
});
