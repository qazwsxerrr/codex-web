export function createSessionSettings(thread = {}, fallback = {}) {
  return {
    model: thread.model || fallback.model || null,
    reasoningEffort: thread.reasoningEffort || thread.effort || fallback.reasoningEffort || null,
    permissions: thread.permissions || thread.activePermissionProfile?.id || fallback.permissions || null,
    serviceTier: thread.serviceTier || fallback.serviceTier || null,
    cwd: thread.cwd || fallback.cwd || "",
  };
}

export function resolveReasoningEffort(source = {}, selected = null, fallback = null) {
  const selectedValue = String(selected || "").trim();
  if (selectedValue) return selectedValue;
  return source.reasoningEffort
    || source.reasoning_effort
    || source.effort
    || source.settings?.reasoningEffort
    || source.settings?.reasoning_effort
    || source.settings?.effort
    || fallback
    || null;
}

export function pushThreadNavigation(navigation, threadId) {
  const items = Array.isArray(navigation?.items) ? navigation.items.slice(0, (navigation.index ?? -1) + 1) : [];
  if (!threadId || items.at(-1) === threadId) return { items, index: items.length - 1 };
  items.push(threadId);
  return { items, index: items.length - 1 };
}

export function navigateThread(navigation, delta) {
  const items = navigation?.items || [];
  const index = Math.max(0, Math.min(items.length - 1, (navigation?.index ?? -1) + delta));
  return { items: [...items], index, threadId: items[index] || null };
}

export function shouldFollowScroll({ scrollTop, scrollHeight, clientHeight }, threshold = 96) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
