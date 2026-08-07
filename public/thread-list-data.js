const GROUP_ORDER = ["today", "yesterday", "thisWeek", "earlier"];
const UNTITLED_CONVERSATION = "Untitled conversation";
const PATH_LABEL_PATTERN = /(?:工作目录|参考目录|当前(?:工作)?目录|项目目录|目录说明|路径|working\s+directory|reference\s+directory|current\s+directory|cwd)\s*(?:为|是)?\s*[:：=]?\s*/giu;
const PATH_PATTERN = /(?:[a-z]:[\\/](?:[^\\/\s]+[\\/])*[^\\/\s]*|\\\\[^\\/\s]+[\\/][^\\/\s]+(?:[\\/][^\\/\s]+)*|\/(?:[^\/\s]+\/)+[^\/\s,;，；。!?！？)）\]}>'"`]*|(?:\.\.?\/|~\/)[^\s,;，；。!?！？)）\]}>'"`]*)/giu;
const COMMAND_PATTERN = /^(?:[$>#]\s*)*(?:cd|bash|sh|zsh|fish|python(?:\d+(?:\.\d+)*)?|node|deno|git|npm|npx|yarn|pnpm|export|source|set|pip|pip3|pytest|make|cargo|go|java|mvn)\b/i;

export const THREAD_GROUP_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  earlier: "Earlier",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripCodeBlocks(value) {
  return String(value || "")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "\n");
}

function stripPathReferences(value) {
  return value
    .replace(PATH_LABEL_PATTERN, " ")
    .replace(PATH_PATTERN, " ");
}

function normalizePreviewLine(line) {
  const withoutMarkdownPrefix = String(line || "")
    .replace(/^\s*(?:[-*+]\s+|>\s+|#{1,6}\s+)/, "")
    .replace(/^\s*\d+[.)]\s+/, "");
  return cleanText(stripPathReferences(withoutMarkdownPrefix))
    .replace(/^[\s"'`“”‘’()[\]{}：:;,，；|]+|[\s"'`“”‘’()[\]{}：:;,，；|]+$/gu, "")
    .trim();
}

function isPathOnly(value) {
  const candidate = cleanText(value);
  if (!candidate) return true;
  return /^(?:[a-z]:[\\/].*|\\\\[^\\/]+[\\/].*|\/(?:[^\/\s]+\/)+[^\/\s]*|(?:\.\.?\/|~\/).*)$/iu.test(candidate);
}

function isPureCommand(value) {
  return COMMAND_PATTERN.test(cleanText(value));
}

export function extractTaskDescription(preview) {
  const source = stripCodeBlocks(preview);
  for (const paragraph of source.split(/\r?\n\s*\r?\n/)) {
    const candidates = [];
    for (const line of paragraph.split(/\r?\n/)) {
      const candidate = normalizePreviewLine(line);
      if (!candidate || isPathOnly(candidate) || isPureCommand(candidate)) continue;
      candidates.push(candidate);
    }
    if (candidates.length) return candidates.join(" ");
  }
  return "";
}

function cwdParts(cwd) {
  const parts = String(cwd || "")
    .trim()
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..");
  if (/^[a-z]:$/iu.test(parts[0] || "")) parts.shift();
  if (parts[0]?.toLocaleLowerCase() === "mnt" && /^[a-z]$/iu.test(parts[1] || "")) parts.splice(0, 2);
  return parts;
}

export function compactThreadCwd(cwd, maxSegments = 3) {
  const parts = cwdParts(cwd);
  const limit = Math.max(1, Number(maxSegments) || 3);
  if (!parts.length) return "";
  if (parts.length <= limit) return parts.join(" › ");
  if (limit === 1) return `… › ${parts.at(-1)}`;
  return [parts.at(-limit), "…", parts.at(-1)].join(" › ");
}

function cwdBasename(cwd) {
  const parts = cwdParts(cwd);
  const last = parts.at(-1) || "";
  return /^[a-z]:$/iu.test(last) ? "" : last;
}

export function threadTitle(thread, maxLength = 72) {
  const title = cleanText(thread?.name)
    || extractTaskDescription(thread?.preview)
    || cwdBasename(thread?.cwd)
    || UNTITLED_CONVERSATION;
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
  return threads.filter((thread) => [thread?.name, thread?.preview, thread?.cwd, threadTitle(thread, 500)]
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
