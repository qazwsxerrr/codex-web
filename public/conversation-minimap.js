export const CHAT_MINIMAP_WIDTH = 36;
export const CHAT_MINIMAP_PADDING = 12;
export const CHAT_MINIMAP_MAX_NODE_GAP = 50;
export const CHAT_MINIMAP_FOCUS_RATIO = 0.3;

export function layoutConversationMinimap(count, height) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  const minimapHeight = Math.max(1, Number(height) || 1);
  const usableHeight = Math.max(0, minimapHeight - CHAT_MINIMAP_PADDING * 2);

  if (total === 0) {
    return {
      positions: [],
      gap: CHAT_MINIMAP_MAX_NODE_GAP,
      fillsHeight: false,
      lineTop: CHAT_MINIMAP_PADDING,
      lineHeight: 1,
    };
  }

  if (total === 1) {
    const position = Math.min(CHAT_MINIMAP_PADDING, minimapHeight);
    return {
      positions: [position],
      gap: CHAT_MINIMAP_MAX_NODE_GAP,
      fillsHeight: false,
      lineTop: position,
      lineHeight: 1,
    };
  }

  const naturalGap = usableHeight / (total - 1);
  const gap = Math.min(CHAT_MINIMAP_MAX_NODE_GAP, naturalGap);
  const positions = Array.from({ length: total }, (_, index) => CHAT_MINIMAP_PADDING + index * gap);
  return {
    positions,
    gap,
    fillsHeight: naturalGap <= CHAT_MINIMAP_MAX_NODE_GAP,
    lineTop: positions[0],
    lineHeight: Math.max(1, positions.at(-1) - positions[0]),
  };
}

export function nearestConversationMinimapIndex(layout, pointerY) {
  const positions = Array.isArray(layout?.positions) ? layout.positions : [];
  if (!positions.length) return -1;

  const y = Number(pointerY);
  if (!Number.isFinite(y)) return -1;
  const gap = Math.max(0, Number(layout?.gap) || 0);
  const rawIndex = gap > 0 ? Math.round((y - positions[0]) / gap) : 0;
  const index = Math.max(0, Math.min(positions.length - 1, rawIndex));

  if (!layout?.fillsHeight) {
    const hitRadius = Math.max(10, gap / 2);
    if (Math.abs(y - positions[index]) > hitRadius) return -1;
  }
  return index;
}

export function activeConversationTurnIndex(
  offsets,
  scrollTop,
  clientHeight,
  focusRatio = CHAT_MINIMAP_FOCUS_RATIO,
) {
  const measured = (Array.isArray(offsets) ? offsets : [])
    .map((offset, index) => ({
      index,
      offset: offset === null || offset === undefined ? Number.NaN : Number(offset),
    }))
    .filter(({ offset }) => Number.isFinite(offset));
  if (!measured.length) return -1;

  const focusTop = (Number(scrollTop) || 0)
    + Math.max(0, Number(clientHeight) || 0) * (Number(focusRatio) || 0);
  return measured.reduce((closest, candidate) => (
    Math.abs(candidate.offset - focusTop) < Math.abs(closest.offset - focusTop)
      ? candidate
      : closest
  ), measured[0]).index;
}

export function conversationPreviewText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "Untitled message";
  const limit = Math.max(1, Math.trunc(Number(maxLength) || 240));
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 3)).trimEnd()}...` : text;
}
