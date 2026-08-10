/**
 * Convert protocol text parts to displayable text without relying on
 * JavaScript's `[object Object]` coercion.  Persisted ThreadItems currently
 * use strings, while newer protocol payloads may use typed `{ type, text }`
 * parts, so the adapter accepts both shapes.
 */
export function protocolPartText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(protocolPartText).filter(Boolean).join("");
  if (typeof value === "object") {
    for (const key of ["text", "value", "content", "message"]) {
      if (value[key] !== undefined && value[key] !== null) {
        const text = protocolPartText(value[key]);
        if (text) return text;
      }
    }
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return String(value);
}

export function protocolPartsText(parts, separator = "") {
  if (!Array.isArray(parts)) return "";
  return parts.map(protocolPartText).filter(Boolean).join(separator);
}

/** Return the human-readable summary/content text for a reasoning item. */
export function reasoningText(item = {}, separator = "\n\n") {
  const summary = protocolPartsText(item.summary, separator) || protocolPartText(item.summaryText);
  const content = protocolPartsText(item.content, separator) || protocolPartText(item.text);
  return [summary, content, item.thinking, item.reasoning]
    .map(protocolPartText)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(separator);
}
