const GROUP_ORDER = ["today", "yesterday", "thisWeek", "earlier"];

export const THREAD_GROUP_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  earlier: "Earlier",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function threadTitle(thread, maxLength = 72) {
  const title = cleanText(thread?.name) || cleanText(thread?.preview) || "Untitled conversation";
  if (title.length <= maxLength) return title;
  return `${title.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function threadTimestamp(thread) {
  const value = thread?.recencyAt ?? thread?.updatedAt ?? thread?.createdAt;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : 0;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function threadGroup(thread, now = new Date()) {
  const date = new Date(threadTimestamp(thread) * 1000);
  if (Number.isNaN(date.getTime())) return "earlier";

  const today = startOfDay(now);
  const threadDay = startOfDay(date);
  const dayDifference = Math.round((today - threadDay) / 86_400_000);
  if (dayDifference <= 0) return "today";
  if (dayDifference === 1) return "yesterday";

  const mondayOffset = (today.getDay() + 6) % 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - mondayOffset);
  return threadDay >= startOfWeek ? "thisWeek" : "earlier";
}

export function filterThreads(threads, query) {
  const term = cleanText(query).toLocaleLowerCase();
  if (!term) return threads;
  return threads.filter((thread) => [threadTitle(thread, 500), thread?.preview, thread?.cwd]
    .some((value) => cleanText(value).toLocaleLowerCase().includes(term)));
}

export function groupThreads(threads, now = new Date()) {
  const groups = new Map(GROUP_ORDER.map((key) => [key, []]));
  for (const thread of threads) groups.get(threadGroup(thread, now)).push(thread);
  return GROUP_ORDER
    .filter((key) => groups.get(key).length)
    .map((key) => ({ key, label: THREAD_GROUP_LABELS[key], threads: groups.get(key) }));
}

export function formatThreadTime(thread, now = new Date(), locale = undefined) {
  const date = new Date(threadTimestamp(thread) * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const group = threadGroup(thread, now);
  if (group === "today" || group === "yesterday") {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (group === "thisWeek") {
    return new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function mergeThreadPages(current, incoming) {
  const byId = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    if (thread?.id) byId.set(thread.id, thread);
  }
  return [...byId.values()].sort((a, b) => threadTimestamp(b) - threadTimestamp(a));
}
