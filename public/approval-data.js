function requestKey(value) {
  return value === undefined || value === null ? null : String(value);
}

export function enqueueApproval(queue, message) {
  const current = Array.isArray(queue) ? queue : [];
  const key = requestKey(message?.id);
  if (!message || key === null || current.some((entry) => requestKey(entry?.id) === key)) return [...current];
  return [...current, message];
}

export function currentApproval(queue) {
  return Array.isArray(queue) ? queue[0] || null : null;
}

export function removeApproval(queue, requestId) {
  const key = requestKey(requestId);
  return (Array.isArray(queue) ? queue : []).filter((entry) => requestKey(entry?.id) !== key);
}
