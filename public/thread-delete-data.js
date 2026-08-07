export function resolveDeleteThreadId(requestedThreadId) {
  const requested = String(requestedThreadId || "").trim();
  return requested || null;
}

export function removeThreadById(threads, threadId) {
  const target = String(threadId || "").trim();
  if (!target) return Array.isArray(threads) ? [...threads] : [];
  return (Array.isArray(threads) ? threads : []).filter((thread) => String(thread?.id || "") !== target);
}

export function removeThreadFromNavigation(navigation, threadId) {
  const target = String(threadId || "").trim();
  const items = Array.isArray(navigation?.items) ? navigation.items : [];
  if (!target || !items.includes(target)) {
    return { items: [...items], index: Number.isInteger(navigation?.index) ? navigation.index : -1 };
  }

  const removedIndex = items.indexOf(target);
  const currentIndex = Number.isInteger(navigation?.index) ? navigation.index : -1;
  const nextItems = items.filter((item) => item !== target);
  const nextIndex = currentIndex >= removedIndex ? currentIndex - 1 : currentIndex;
  return {
    items: nextItems,
    index: nextItems.length ? Math.max(-1, Math.min(nextIndex, nextItems.length - 1)) : -1,
  };
}
