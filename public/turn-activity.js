export function timestampToMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim() && !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
}

export function isActiveTurnStatus(status) {
  const value = String(status || "").replace(/[_-]/g, "").toLowerCase();
  return ["active", "inprogress", "running", "started", "processing", "cancelling"].includes(value);
}

export function resolveTurnDurationMs(turn = {}, fallbackStartedAtMs = null, endAtMs = Date.now()) {
  const explicit = Number(turn?.durationMs);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const startedAt = timestampToMs(turn?.startedAt) ?? fallbackStartedAtMs;
  if (!Number.isFinite(startedAt)) return null;
  const completedAt = timestampToMs(turn?.completedAt)
    ?? timestampToMs(turn?.endedAt)
    ?? (Number.isFinite(endAtMs) ? endAtMs : Date.now());
  return Math.max(0, completedAt - startedAt);
}

export function formatActivityDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value)) return "";
  let seconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);
  return parts.join(" ");
}
