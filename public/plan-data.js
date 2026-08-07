const PLAN_STATUSES = new Set(["pending", "inProgress", "completed"]);

export const PLAN_IMPLEMENTATION_PROMPT = "Implement the plan.";

/**
 * Keep the server's plan status vocabulary intact. Unknown values are surfaced
 * as neutral instead of being guessed into a completed or active state.
 */
export function normalizePlanStatus(value) {
  const raw = String(value ?? "").trim();
  if (PLAN_STATUSES.has(raw)) return raw;
  if (["in_progress", "in-progress", "working", "active"].includes(raw)) return "inProgress";
  if (["complete", "done"].includes(raw)) return "completed";
  return "unknown";
}

export function normalizePlanStep(step, index = 0) {
  const source = step && typeof step === "object" ? step : { step: String(step ?? "") };
  return {
    id: String(source.id || `${index}`),
    index,
    step: typeof source.step === "string" ? source.step : String(source.text ?? ""),
    status: normalizePlanStatus(source.status),
  };
}

export function normalizePlanSnapshot(params = {}, fallback = {}) {
  const source = params && typeof params === "object" ? params : {};
  const plan = Array.isArray(source.plan) ? source.plan : [];
  return {
    threadId: source.threadId ?? fallback.threadId ?? null,
    turnId: source.turnId ?? fallback.turnId ?? null,
    explanation: typeof source.explanation === "string" ? source.explanation : null,
    steps: plan.map((step, index) => normalizePlanStep(step, index)),
  };
}

export function planSnapshotKey(threadId, turnId) {
  return `${String(threadId || "thread")}:${String(turnId || "turn")}`;
}

export function isStructuredPlanSnapshot(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.steps));
}

export function canImplementPlan({ mode = "", running = false, turnStatus = "", hasPlan = false } = {}) {
  return String(mode || "").trim() === "plan"
    && !running
    && String(turnStatus || "").trim() === "completed"
    && Boolean(hasPlan);
}
