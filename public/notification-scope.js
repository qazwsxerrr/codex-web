export function isNotificationForThread(params = {}, threadId = "") {
  const eventThreadId = String(params?.threadId || "").trim();
  const currentThreadId = String(threadId || "").trim();
  return !eventThreadId || eventThreadId === currentThreadId;
}
