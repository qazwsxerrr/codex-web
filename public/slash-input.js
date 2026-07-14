export function resolveSlashSelection(value, command, source = "enter") {
  if (!command) return { kind: "none", value: String(value || "") };

  const trimmed = String(value || "").trim();
  const hasArguments = /^\/\S+\s+\S/.test(trimmed);

  if (source === "tab" || (command.requiresArgs && !hasArguments)) {
    return { kind: "fill", value: `${command.name} ` };
  }

  return {
    kind: "submit",
    value: hasArguments ? trimmed : command.name,
  };
}

export function prioritizeSlashMatches(token, commands) {
  const matches = commands.filter((command) => command.name.startsWith(token));
  if (token !== "/s") return matches;
  return matches.toSorted((left, right) => {
    if (left.name === "/status") return -1;
    if (right.name === "/status") return 1;
    return 0;
  });
}

export function guardianEventFromNotification(params) {
  const review = params?.review;
  if (!params?.reviewId || !params?.turnId || review?.status !== "denied" || !params?.action) {
    return null;
  }
  return {
    id: params.reviewId,
    targetItemId: params.targetItemId ?? null,
    turnId: params.turnId,
    startedAtMs: params.startedAtMs,
    completedAtMs: params.completedAtMs,
    status: review.status,
    riskLevel: review.riskLevel ?? null,
    userAuthorization: review.userAuthorization ?? null,
    rationale: review.rationale ?? null,
    decisionSource: params.decisionSource ?? null,
    action: params.action,
  };
}
