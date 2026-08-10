export function notificationThreadId(params = {}) {
  const value = params?.threadId
    || params?.runtime?.threadId
    || params?.thread?.id
    || params?.payload?.threadId;
  const threadId = String(value || "").trim();
  return threadId || null;
}

export function isNotificationForThread(params = {}, threadId = "") {
  const eventThreadId = notificationThreadId(params) || "";
  const currentThreadId = String(threadId || "").trim();
  return !eventThreadId || eventThreadId === currentThreadId;
}
