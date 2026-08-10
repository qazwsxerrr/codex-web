export const SNAPSHOT_REASON_ACTIVE_WRITER = "active_writer";

export function isSnapshotAccess(accessMode) {
  return String(accessMode || "").trim().toLowerCase() === "snapshot";
}

export function formatAccessTimestamp(value, locale = undefined) {
  if (value === null || value === undefined || value === "") return "unknown time";
  const numeric = typeof value === "number" || /^[+-]?\d+(?:\.\d+)?$/.test(String(value).trim())
    ? Number(value)
    : Date.parse(String(value));
  if (!Number.isFinite(numeric)) return "unknown time";
  const ms = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ms));
}

export function snapshotBannerText({ accessMode, snapshotAt, snapshotReason } = {}) {
  if (!isSnapshotAccess(accessMode)) return "";
  const reason = snapshotReason === SNAPSHOT_REASON_ACTIVE_WRITER
    ? "该会话正由 Codex CLI 控制"
    : "该会话当前为只读状态";
  return `只读快照 · 截止 ${formatAccessTimestamp(snapshotAt)} · ${reason}`;
}

export function accessControlState({ accessMode, hasThread = false, running = false, awaitingUserInput = false, threadWritable = true } = {}) {
  const snapshot = isSnapshotAccess(accessMode);
  const writable = Boolean(threadWritable && !snapshot);
  return {
    snapshot,
    canWrite: Boolean(hasThread && writable),
    canSend: Boolean(hasThread && writable && !running && !awaitingUserInput),
    canSteer: Boolean(hasThread && writable && running && !awaitingUserInput),
    canInterrupt: Boolean(hasThread && writable && running),
    showInterrupt: Boolean(hasThread && writable && running),
    showWorkingTimer: !snapshot,
  };
}
