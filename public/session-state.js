export function createSessionSettings(thread = {}, fallback = {}) {
  const source = thread?.thread || thread?.latestThread || thread?.latestThreadResponse?.thread || thread || {};
  const pending = thread?.pendingTurnSettings || {};
  return {
    model: pending.model || pending.modelId || source.model || thread.model || fallback.model || null,
    reasoningEffort: pending.reasoningEffort || pending.reasoning_effort || pending.effort
      || source.reasoningEffort || source.reasoning_effort || source.effort
      || thread.reasoningEffort || thread.effort || fallback.reasoningEffort || null,
    permissions: pending.permissions || pending.activePermissionProfile?.id
      || source.permissions || source.activePermissionProfile?.id
      || thread.permissions || thread.activePermissionProfile?.id || fallback.permissions || null,
    serviceTier: pending.serviceTier || source.serviceTier || thread.serviceTier || fallback.serviceTier || null,
    collaborationMode: pending.collaborationMode || source.collaborationMode || thread.collaborationMode || fallback.collaborationMode || null,
    cwd: source.cwd || thread.cwd || fallback.cwd || "",
  };
}

function normalizedText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function readSetting(source, keys) {
  if (!source || typeof source !== "object") return { present: false, value: undefined };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return { present: true, value: source[key] };
  }
  return { present: false, value: undefined };
}

function normalizedPermission(value) {
  if (value && typeof value === "object") return normalizedText(value.id || value.name || value.permissionProfile);
  return normalizedText(value);
}

function collaborationModeMatches(actual, expected) {
  if (actual === undefined) return true;
  if (actual === null || expected === null) return actual === expected;
  if (typeof actual !== "object" || typeof expected !== "object") {
    return normalizedText(actual) === normalizedText(expected);
  }
  const actualMode = normalizedText(actual.mode || actual.name);
  const expectedMode = normalizedText(expected.mode || expected.name);
  if (actualMode && expectedMode && actualMode !== expectedMode) return false;
  const actualSettings = actual.settings && typeof actual.settings === "object" ? actual.settings : actual;
  const expectedSettings = expected.settings && typeof expected.settings === "object" ? expected.settings : expected;
  const actualModel = readSetting(actualSettings, ["model", "modelId"]);
  const expectedModel = readSetting(expectedSettings, ["model", "modelId"]);
  if (actualModel.present && expectedModel.present
    && normalizedText(actualModel.value) !== normalizedText(expectedModel.value)) return false;
  const actualEffort = readSetting(actualSettings, ["reasoning_effort", "reasoningEffort", "effort"]);
  const expectedEffort = readSetting(expectedSettings, ["reasoning_effort", "reasoningEffort", "effort"]);
  if (actualEffort.present && expectedEffort.present
    && normalizedText(actualEffort.value) !== normalizedText(expectedEffort.value)) return false;
  return true;
}

export function buildCollaborationModePayload({ value = "", preset = null, model = "", effort = "default" } = {}) {
  const mode = String(value || "").trim();
  if (!mode) return null;
  const presetMode = String(preset?.mode || mode).trim() || mode;
  const presetEffort = preset?.reasoning_effort ?? preset?.reasoningEffort ?? effort;
  return {
    mode: presetMode,
    settings: {
      model: String(model || ""),
      reasoning_effort: presetEffort && presetEffort !== "default" ? String(presetEffort) : null,
      developer_instructions: null,
    },
  };
}

export function settingsSnapshotsMatch(actual = {}, expected = {}) {
  const actualSource = actual?.threadSettings && typeof actual.threadSettings === "object" ? actual.threadSettings : actual;
  const expectedSource = expected?.threadSettings && typeof expected.threadSettings === "object" ? expected.threadSettings : expected;
  const fields = [
    ["model", ["model", "modelId"], (value) => normalizedText(value)],
    ["effort", ["effort", "reasoningEffort", "reasoning_effort"], (value) => normalizedText(value)],
    ["serviceTier", ["serviceTier", "service_tier"], (value) => normalizedText(value)],
    ["permissions", ["permissions", "activePermissionProfile", "permissionProfile"], normalizedPermission],
  ];
  for (const [, keys, normalize] of fields) {
    const expectedValue = readSetting(expectedSource, keys);
    if (!expectedValue.present) continue;
    const actualValue = readSetting(actualSource, keys);
    if (actualValue.present && normalize(actualValue.value) !== normalize(expectedValue.value)) return false;
  }
  const expectedMode = readSetting(expectedSource, ["collaborationMode", "collaboration_mode"]);
  if (expectedMode.present) {
    const actualMode = readSetting(actualSource, ["collaborationMode", "collaboration_mode"]);
    if (actualMode.present && !collaborationModeMatches(actualMode.value, expectedMode.value)) return false;
  }
  return true;
}

export function shouldApplySettingsResponse({ response = {}, expected = null, responseRevision = null, latestRevision = null } = {}) {
  const hasResponseRevision = responseRevision !== null && responseRevision !== undefined && responseRevision !== "";
  const hasLatestRevision = latestRevision !== null && latestRevision !== undefined && latestRevision !== "";
  if (hasResponseRevision && hasLatestRevision && Number(responseRevision) !== Number(latestRevision)) return false;
  return !expected || settingsSnapshotsMatch(response, expected);
}

export function retireSettingsRequest(requests, threadId, response = {}, responseRevision = null) {
  const id = String(threadId || "").trim();
  const latest = id && requests?.get?.(id);
  if (!latest || !shouldApplySettingsResponse({
    response,
    expected: latest.settings,
    responseRevision,
    latestRevision: latest.revision,
  })) return false;
  requests.delete(id);
  return true;
}

export function enqueueSerialTask(queues, key, task) {
  const id = String(key || "").trim();
  if (!id || typeof task !== "function") return Promise.reject(new Error("A queue key and task are required"));
  const previous = queues.get(id) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(id, next);
  next.then(
    () => { if (queues.get(id) === next) queues.delete(id); },
    () => { if (queues.get(id) === next) queues.delete(id); },
  );
  return next;
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
