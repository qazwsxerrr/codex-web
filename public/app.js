import DOMPurify from "/vendor/dompurify/dist/purify.es.mjs";
import katex from "/vendor/katex/dist/katex.mjs";
import { marked } from "/vendor/marked/lib/marked.esm.js";
import { extractMath, renderMathSlots } from "/math-renderer.js";
import { guardianEventFromNotification, prioritizeSlashMatches, resolveSlashSelection } from "/slash-input.js";
import { slashAliases, slashCommands } from "/slash-commands.js";
import { codexVersion, formatCompactNumber, providerStatus, threadTokenStats, unwrapConfig } from "/status-data.js";
import { formatMcpInventory, normalizeMcpInventory } from "/mcp-data.js";
import { filterThreads, formatThreadTime, groupThreads, mergeThreadPages, threadTitle } from "/thread-list-data.js";
import { composeUserInput, displayInput, makeMention, MAX_IMAGES, validateImage } from "/composer-input.js";
import { diffRowMarker, normalizeFileChanges, visibleDiffRows } from "/diff-data.js";
import { normalizeThread } from "/thread-items.js";
import { createSessionSettings, navigateThread, pushThreadNavigation, resolveReasoningEffort, shouldFollowScroll } from "/session-state.js";
import { formatActivityDuration, isActiveTurnStatus, resolveTurnDurationMs, timestampToMs } from "/turn-activity.js";
import { renderIcons } from "/icons.js";

marked.setOptions({ gfm: true, breaks: false });

const $ = (selector) => document.querySelector(selector);
const connectionStatus = $("#connectionStatus");
const cwdInput = $("#cwdInput");
const modelSelect = $("#modelSelect");
const effortSelect = $("#effortSelect");
const tierSelect = $("#tierSelect");
const permissionSelect = $("#permissionSelect");
const newThreadButton = $("#newThreadButton");
const refreshThreadsButton = $("#refreshThreadsButton");
const loadMoreThreadsButton = $("#loadMoreThreadsButton");
const threadSearchInput = $("#threadSearchInput");
const threadList = $("#threadList");
const threadListStatus = $("#threadListStatus");
const statusButton = $("#statusButton");
const threadIdInput = $("#threadIdInput");
const resumeButton = $("#resumeButton");
const sessionSummary = $("#sessionSummary");
const directorySummary = $("#directorySummary");
const runStatus = $("#runStatus");
const contextSummary = $("#contextSummary");
const chat = $("#chat");
const approvalArea = $("#approvalArea");
const turnActivity = $("#turnActivity");
const messageInput = $("#messageInput");
const slashPalette = $("#slashPalette");
const sendButton = $("#sendButton");
const stopButton = $("#stopButton");
const threadLabel = $("#threadLabel");
const statusDialog = $("#statusDialog");
const statusSubtitle = $("#statusSubtitle");
const statusGrid = $("#statusGrid");
const rawStatus = $("#rawStatus");
const textDialog = $("#textDialog");
const textDialogTitle = $("#textDialogTitle");
const textDialogBody = $("#textDialogBody");
const inspector = $("#inspector");
const inspectorModelSelect = $("#inspectorModelSelect");
const inspectorEffortSelect = $("#inspectorEffortSelect");
const providerSummary = $("#providerSummary");
const inspectorConnection = $("#inspectorConnection");
const inspectorThreadId = $("#inspectorThreadId");
const contextMeterFill = $("#contextMeterFill");
const contextDetail = $("#contextDetail");
const mcpInspectorList = $("#mcpInspectorList");
const workspaceName = $("#workspaceName");
const branchSummary = $("#branchSummary");
const changesList = $("#changesList");
const changesStats = $("#changesStats");
const changesTurnSummary = $("#changesTurnSummary");
const commandsList = $("#commandsList");
const commandsSummary = $("#commandsSummary");
const mentionPalette = $("#mentionPalette");
const attachmentChips = $("#attachmentChips");
const imageInput = $("#imageInput");
const jumpToBottomButton = $("#jumpToBottomButton");
const sidebar = $("#sidebar");
const sidebarToggleButton = $("#mobileSidebarButton");
const drawerBackdrop = $("#drawerBackdrop");
const cwdDialog = $("#cwdDialog");
const cwdDialogInput = $("#cwdDialogInput");
const inspectorTitle = $("#inspectorTitle");
const outlineTab = $("#outlineTab");
const sessionTab = $("#sessionTab");
const outlinePanel = $("#outlinePanel");
const sessionPanel = $("#sessionPanel");
const outlineCount = $("#outlineCount");
const conversationOutline = $("#conversationOutline");
const outlineBottomButton = $("#outlineBottomButton");

const state = {
  ready: false,
  models: [],
  config: null,
  account: null,
  permissionProfiles: [],
  experiments: [],
  collaborationModes: [],
  metadataErrors: {},
  threadId: null,
  activeTurnId: null,
  running: false,
  threadStatus: "notLoaded",
  threadMeta: {},
  tokenUsage: null,
  tokenUsageThreadId: null,
  serverInfo: null,
  latestDiff: "",
  messageNodes: new Map(),
  toolNodes: new Map(),
  renderTimers: new Map(),
  toolOutputTimers: new Map(),
  viewRenderTimers: new Map(),
  pendingScrollFrame: null,
  threadUiSaveTimer: null,
  approvals: [],
  latestGuardianDenial: null,
  mcpStartupStatuses: {},
  paletteIndex: 0,
  choicePalette: null,
  threads: [],
  threadListCursor: null,
  threadListError: null,
  threadListLoading: true,
  sessionSettings: createSessionSettings(),
  activeView: "conversation",
  threadView: normalizeThread({}),
  commandItems: new Map(),
  changeItems: new Map(),
  turnDiff: "",
  currentTurn: null,
  activityMode: "idle",
  activityStartedAtMs: null,
  activityDurationMs: null,
  activityStatus: null,
  activityTimer: null,
  mentions: [],
  images: [],
  fileMatches: [],
  mentionIndex: 0,
  mentionQuery: "",
  mentionTimer: null,
  searchTimer: null,
  navigation: { items: [], index: -1 },
  navigatingHistory: false,
  followOutput: true,
  composing: false,
  mcpInventory: [],
  mcpDialogRequested: false,
  latestUserInput: "",
  threadUi: null,
  expandedFileChanges: new Set(),
  expandedDiffFiles: new Set(),
  outlineObserver: null,
  activeOutlineMessageId: null,
};

renderIcons();

/*const slashCommands = [
  // Codex CLI 0.144.1 presentation order on Linux/WSL. /fast is a dynamic
  // service-tier command surfaced by the TUI when the selected model supports it.
  { name: "/model", usage: "/model [model-id] [effort]", description: "choose what model and reasoning effort to use", implemented: true },
  { name: "/fast", usage: "/fast [on|off|status]", description: "toggle the model fast/priority service tier", implemented: true, dynamic: true },
  { name: "/ide", usage: "/ide", description: "include current selection, open files, and other context from your IDE", unavailable: true },
  { name: "/permissions", usage: "/permissions [profile-id]", description: "choose what Codex is allowed to do", implemented: true },
  { name: "/keymap", usage: "/keymap", description: "remap TUI shortcuts", unavailable: true },
  { name: "/vim", usage: "/vim", description: "toggle Vim mode for the composer", unavailable: true },
  { name: "/setup-default-sandbox", usage: "/setup-default-sandbox", description: "set up elevated agent sandbox", unavailable: true },
  { name: "/experimental", usage: "/experimental [feature] [on|off|toggle]", description: "toggle experimental features", implemented: true },
  { name: "/approve", usage: "/approve", description: "approve one retry of a recent auto-review denial", implemented: true },
  { name: "/memories", usage: "/memories [on|off|status]", description: "configure memory use and generation", implemented: true },
  { name: "/skills", usage: "/skills [reload]", description: "use skills to improve how Codex performs specific tasks", implemented: true },
  { name: "/import", usage: "/import", description: "import setup, project, and recent chats from Claude Code", unavailable: true },
  { name: "/hooks", usage: "/hooks", description: "view and manage lifecycle hooks", implemented: true },
  { name: "/review", usage: "/review [instructions]", description: "review my current changes and find issues", implemented: true },
  { name: "/rename", usage: "/rename <name>", description: "rename the current thread", implemented: true, requiresArgs: true },
  { name: "/new", usage: "/new", description: "start a new chat during a conversation", implemented: true },
  { name: "/archive", usage: "/archive", description: "archive this session", implemented: true },
  { name: "/delete", usage: "/delete", description: "permanently delete this session", implemented: true },
  { name: "/resume", usage: "/resume [thread-id]", description: "resume a saved chat", implemented: true },
  { name: "/fork", usage: "/fork", description: "fork the current chat", implemented: true },
  { name: "/init", usage: "/init", description: "create an AGENTS.md file with instructions for Codex", unavailable: true },
  { name: "/compact", usage: "/compact", description: "summarize conversation to prevent hitting the context limit", implemented: true },
  { name: "/plan", usage: "/plan", description: "switch to Plan mode", unavailable: true },
  { name: "/goal", usage: "/goal [clear|objective]", description: "set or view the goal for a long-running task", implemented: true },
  { name: "/agent", usage: "/agent", description: "switch the active agent thread", unavailable: true },
  { name: "/side", usage: "/side [message]", description: "start a side conversation in an ephemeral fork", unavailable: true },
  { name: "/btw", usage: "/btw [message]", description: "start a side conversation in an ephemeral fork", unavailable: true },
  { name: "/copy", usage: "/copy", description: "copy last response as markdown", implemented: true },
  { name: "/raw", usage: "/raw", description: "toggle raw scrollback mode for copy-friendly terminal selection", unavailable: true },
  { name: "/diff", usage: "/diff", description: "show the latest diff received from Codex", implemented: true },
  { name: "/mention", usage: "/mention", description: "mention a file", unavailable: true },
  { name: "/status", usage: "/status", description: "show current session configuration and token usage", implemented: true },
  { name: "/usage", usage: "/usage", description: "view account usage or use a usage limit reset", implemented: true },
  { name: "/debug-config", usage: "/debug-config", description: "show config layers and requirement sources for debugging", implemented: true },
  { name: "/title", usage: "/title", description: "configure which items appear in the terminal title", unavailable: true },
  { name: "/statusline", usage: "/statusline", description: "configure which items appear in the status line", unavailable: true },
  { name: "/theme", usage: "/theme", description: "choose a syntax highlighting theme", unavailable: true },
  { name: "/pets", usage: "/pets", description: "choose or hide the terminal pet", unavailable: true },
  { name: "/mcp", usage: "/mcp [verbose|reload]", description: "list configured MCP tools; use /mcp verbose for details", implemented: true },
  { name: "/apps", usage: "/apps [reload]", description: "manage apps", implemented: true },
  { name: "/plugins", usage: "/plugins", description: "browse plugins", implemented: true },
  { name: "/logout", usage: "/logout", description: "log out of Codex", implemented: true },
  { name: "/quit", usage: "/quit", description: "disconnect this web client", implemented: true },
  { name: "/exit", usage: "/exit", description: "disconnect this web client", implemented: true },
  { name: "/feedback", usage: "/feedback", description: "send logs to maintainers", unavailable: true },
  { name: "/ps", usage: "/ps", description: "list background terminals", implemented: true },
  { name: "/stop", usage: "/stop", description: "stop all background terminals", implemented: true },
  { name: "/clear", usage: "/clear", description: "clear the transcript and start a new chat", implemented: true },
  { name: "/personality", usage: "/personality", description: "choose a communication style for Codex", unavailable: true },
  { name: "/subagents", usage: "/subagents", description: "switch the active agent thread", unavailable: true },
  { name: "/debug-m-drop", usage: "/debug-m-drop", description: "DO NOT USE (Codex debug command)", unavailable: true },
  { name: "/debug-m-update", usage: "/debug-m-update", description: "DO NOT USE (Codex debug command)", unavailable: true },
];*/

/*const slashAliases = new Map([
  ["/clean", "/stop"],
  ["/pet", "/pets"],
]);*/

const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${wsProtocol}//${location.host}/ws`);

function send(payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    addSystemMessage("WebSocket is not connected.", "error");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function setConnection(text, online) {
  connectionStatus.textContent = text;
  const dot = document.createElement("span");
  connectionStatus.prepend(dot);
  connectionStatus.className = `connection-badge ${online ? "status-online" : "status-offline"}`;
  inspectorConnection.textContent = text;
}

function shortPath(value) {
  const parts = String(value || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "Workspace";
}

function copySelectOptions(source, target) {
  const value = source.value;
  target.replaceChildren(...[...source.options].map((option) => option.cloneNode(true)));
  target.value = value;
  target.disabled = source.disabled;
}

function modelId(model) {
  return model?.id || model?.model || model?.slug || "";
}

function modelName(model) {
  return model?.displayName || model?.display_name || modelId(model);
}

function effortId(effort) {
  return effort?.reasoningEffort || effort?.reasoning_effort || effort?.effort || effort?.id || String(effort || "");
}

function modelEfforts(model) {
  const values = model?.supportedReasoningEfforts || model?.supported_reasoning_efforts || model?.reasoningEfforts || [];
  return Array.isArray(values) ? values : [];
}

function modelTiers(model) {
  const primary = model?.serviceTiers || model?.service_tiers || [];
  const additional = model?.additionalSpeedTiers || model?.additional_speed_tiers || [];
  return [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(additional) ? additional : [])];
}

function tierId(tier) {
  return tier?.id || tier?.tier || tier?.serviceTier || tier?.service_tier || tier?.name || String(tier || "");
}

function permissionId(profile) {
  return profile?.id || profile?.name || profile?.permissionProfile || String(profile || "");
}

function permissionName(profile) {
  return profile?.displayName || profile?.display_name || permissionId(profile);
}

function activePermissionId() {
  const active = state.threadMeta.activePermissionProfile || state.threadMeta.permissionProfile || state.threadMeta.permissions;
  return active?.id || active?.name || (typeof active === "string" ? active : "");
}

function configValue(...keys) {
  const config = unwrapConfig(state.config);
  for (const key of keys) {
    if (config?.[key] !== undefined && config[key] !== null) return config[key];
  }
  return null;
}

function normalizeThreadStatus(value) {
  if (!value) return "notLoaded";
  if (typeof value === "string") return value;
  return value.type || value.status || "unknown";
}

function formatNumber(value) {
  return formatCompactNumber(value);
}

function selectedModel() {
  return state.models.find((model) => modelId(model) === modelSelect.value) || null;
}

function selectedSettings() {
  return {
    model: modelSelect.value || null,
    effort: effortSelect.value || null,
    serviceTier: tierSelect.value || null,
    permissions: permissionSelect.value || null,
  };
}

function populateModels(preferred) {
  const previous = preferred || modelSelect.value || localStorage.getItem("codexMathModel") || configValue("model");
  modelSelect.replaceChildren();

  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = modelId(model);
    option.textContent = modelName(model);
    modelSelect.append(option);
  }

  let next = previous;
  if (!next || !state.models.some((model) => modelId(model) === next)) {
    next = modelId(state.models.find((model) => model?.isDefault || model?.is_default)) || modelId(state.models[0]);
  }
  if (next) modelSelect.value = next;
  populateEfforts();
  populateTiers();
  populatePermissions();
}

function populateEfforts(preferred) {
  const model = selectedModel();
  const efforts = modelEfforts(model);
  const previous = preferred || effortSelect.value || localStorage.getItem("codexMathEffort") || configValue("model_reasoning_effort", "reasoning_effort");
  effortSelect.replaceChildren();

  for (const effort of efforts) {
    const id = effortId(effort);
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    if (effort?.description) option.title = effort.description;
    effortSelect.append(option);
  }

  if (!efforts.length && previous) {
    const option = document.createElement("option");
    option.value = previous;
    option.textContent = previous;
    effortSelect.append(option);
  }

  const fallback = model?.defaultReasoningEffort || model?.default_reasoning_effort || effortId(efforts[0]);
  const next = efforts.some((effort) => effortId(effort) === previous) ? previous : fallback;
  if (next) effortSelect.value = next;
}

function populateTiers(preferred) {
  const model = selectedModel();
  const tiers = modelTiers(model);
  const previous = preferred ?? tierSelect.value ?? localStorage.getItem("codexMathTier") ?? configValue("service_tier", "serviceTier") ?? model?.defaultServiceTier ?? model?.default_service_tier ?? "";
  tierSelect.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "default";
  tierSelect.append(defaultOption);

  for (const tier of tiers) {
    const id = tierId(tier);
    if (!id) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    tierSelect.append(option);
  }

  if (previous && ![...tierSelect.options].some((option) => option.value === previous)) {
    const option = document.createElement("option");
    option.value = previous;
    option.textContent = previous;
    tierSelect.append(option);
  }
  tierSelect.value = previous || "";
}

function populatePermissions(preferred) {
  const previous = preferred ?? permissionSelect.value ?? localStorage.getItem("codexMathPermissions") ?? activePermissionId() ?? "";
  permissionSelect.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "default";
  permissionSelect.append(defaultOption);

  for (const profile of state.permissionProfiles) {
    const id = permissionId(profile);
    if (!id) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${permissionName(profile)}${profile?.allowed === false ? " (blocked)" : ""}`;
    option.disabled = profile?.allowed === false;
    if (profile?.description) option.title = profile.description;
    permissionSelect.append(option);
  }

  if (previous && ![...permissionSelect.options].some((option) => option.value === previous)) {
    const option = document.createElement("option");
    option.value = previous;
    option.textContent = previous;
    permissionSelect.append(option);
  }
  permissionSelect.value = previous || "";
}

function saveControlPreferences() {
  localStorage.setItem("codexMathModel", modelSelect.value);
  localStorage.setItem("codexMathEffort", effortSelect.value);
  localStorage.setItem("codexMathTier", tierSelect.value);
  localStorage.setItem("codexMathPermissions", permissionSelect.value);
}

function contextStats() {
  const stats = threadTokenStats(state.tokenUsage);
  return { ...stats, used: stats.contextUsed, percent: stats.usedPercent };
}

function renderContextSummary(context = contextStats()) {
  const full = context.leftPercent === null
    ? "Context --"
    : `Context ${context.leftPercent.toFixed(0)}% left (${formatNumber(context.used)} / ${formatNumber(context.windowSize)})`;
  const compact = context.leftPercent === null
    ? "Context --"
    : `Context ${context.leftPercent.toFixed(0)}% left`;
  const narrow = window.matchMedia?.("(max-width: 639px)")?.matches === true;
  contextSummary.textContent = narrow ? compact : full;
  contextSummary.title = full;
}

function currentModelLabel() {
  return state.threadMeta.model || modelSelect.value || "unknown-model";
}

function currentEffortLabel() {
  return state.threadMeta.reasoningEffort
    || state.threadMeta.reasoning_effort
    || state.threadMeta.effort
    || effortSelect.value
    || "default";
}

function displayEffortLabel() {
  return resolveReasoningEffort(state.threadMeta, effortSelect.value, "default") || "default";
}

function currentTierLabel() {
  return state.threadMeta.serviceTier || tierSelect.value || "default";
}

function currentCwd() {
  return state.threadMeta.cwd || cwdInput.value || "";
}

function stopActivityTimer() {
  if (!state.activityTimer) return;
  clearInterval(state.activityTimer);
  state.activityTimer = null;
}

function renderTurnActivity() {
  if (!turnActivity) return;
  const mode = state.activityMode;
  turnActivity.replaceChildren();
  turnActivity.className = `turn-activity${mode === "idle" ? " hidden" : ` ${mode}`}`;
  if (mode === "idle") return;

  const symbol = document.createElement("span");
  symbol.className = "activity-symbol";
  symbol.setAttribute("aria-hidden", "true");
  const label = document.createElement("strong");
  label.className = "activity-label";
  const detail = document.createElement("span");
  detail.className = "activity-detail";

  if (mode === "working") {
    const elapsed = Math.max(0, Date.now() - (state.activityStartedAtMs || Date.now()));
    symbol.textContent = "●";
    label.textContent = "Working";
    detail.textContent = `(${formatActivityDuration(elapsed)} • Esc to interrupt)`;
    turnActivity.setAttribute("aria-label", `Working for ${formatActivityDuration(elapsed)}`);
  } else {
    symbol.textContent = "─";
    const duration = formatActivityDuration(state.activityDurationMs);
    label.textContent = duration ? `Worked for ${duration}` : "Worked";
    if (state.activityStatus && !["completed", "complete", "idle"].includes(String(state.activityStatus).toLowerCase())) {
      detail.textContent = `(${state.activityStatus})`;
    }
    turnActivity.setAttribute("aria-label", label.textContent);
  }
  turnActivity.append(symbol, label, detail);
}

function setTurnActivityWorking(startedAt = null) {
  const wasWorking = state.activityMode === "working";
  const explicitStart = timestampToMs(startedAt);
  state.activityMode = "working";
  state.activityStartedAtMs = explicitStart ?? (wasWorking ? state.activityStartedAtMs : Date.now());
  state.activityDurationMs = null;
  state.activityStatus = "inProgress";
  renderTurnActivity();
  if (!state.activityTimer) {
    state.activityTimer = setInterval(() => {
      if (state.activityMode !== "working") {
        stopActivityTimer();
        return;
      }
      renderTurnActivity();
    }, 1000);
  }
}

function setTurnActivityWorked(turn = {}, fallbackStartedAtMs = state.activityStartedAtMs) {
  stopActivityTimer();
  state.activityMode = "worked";
  state.activityDurationMs = resolveTurnDurationMs(turn, fallbackStartedAtMs);
  state.activityStartedAtMs = timestampToMs(turn?.startedAt) ?? fallbackStartedAtMs;
  state.activityStatus = turn?.status || "completed";
  renderTurnActivity();
}

function clearTurnActivity() {
  stopActivityTimer();
  state.activityMode = "idle";
  state.activityStartedAtMs = null;
  state.activityDurationMs = null;
  state.activityStatus = null;
  renderTurnActivity();
}

function syncTurnActivityFromThread(thread) {
  const latestTurn = Array.isArray(thread?.turns) ? thread.turns.at(-1) : null;
  if (!latestTurn) {
    clearTurnActivity();
  } else if (isActiveTurnStatus(latestTurn.status)) {
    setTurnActivityWorking(latestTurn.startedAt);
  } else {
    setTurnActivityWorked(latestTurn, timestampToMs(latestTurn.startedAt));
  }
}

function updateControls() {
  const hasThread = Boolean(state.threadId);
  const canConfigure = state.ready && !state.running;
  modelSelect.disabled = !state.ready;
  effortSelect.disabled = !state.ready || !modelSelect.value;
  tierSelect.disabled = !state.ready || !modelSelect.value;
  permissionSelect.disabled = !state.ready;
  newThreadButton.disabled = !canConfigure;
  refreshThreadsButton.disabled = !state.ready || state.threadListLoading;
  loadMoreThreadsButton.disabled = !state.ready || state.threadListLoading;
  resumeButton.disabled = !canConfigure;
  statusButton.disabled = !state.ready;
  messageInput.disabled = !hasThread || state.running;
  sendButton.disabled = !hasThread || state.running;
  stopButton.disabled = !state.running;
  stopButton.classList.toggle("hidden", !state.running);
  sendButton.classList.toggle("hidden", state.running);

  const model = currentModelLabel();
  const effort = displayEffortLabel();
  const tier = currentTierLabel();
  sessionSummary.textContent = hasThread ? `${model} ${effort}${tier !== "default" ? ` / ${tier}` : ""}` : "No active thread";
  directorySummary.textContent = currentCwd();
  runStatus.textContent = state.threadStatus || (state.running ? "active" : hasThread ? "idle" : "notLoaded");
  runStatus.className = `pill status-${String(state.threadStatus || "unknown").replace(/[^a-zA-Z]/g, "").toLowerCase()}`;
  renderTurnActivity();

  const context = contextStats();
  renderContextSummary(context);

  threadLabel.textContent = hasThread ? `Thread: ${state.threadId}` : "No active thread";
  state.sessionSettings = createSessionSettings(state.threadMeta, {
    model: modelSelect.value,
    reasoningEffort: effortSelect.value,
    permissions: permissionSelect.value,
    serviceTier: tierSelect.value,
    cwd: cwdInput.value,
  });
  copySelectOptions(modelSelect, inspectorModelSelect);
  copySelectOptions(effortSelect, inspectorEffortSelect);
  workspaceName.textContent = shortPath(currentCwd());
  workspaceName.parentElement.title = currentCwd() || "Change working directory";
  directorySummary.title = currentCwd() || "Working directory unavailable";
  const branch = state.threadMeta.gitInfo?.branch;
  branchSummary.classList.toggle("hidden", !branch);
  branchSummary.querySelector("span").textContent = branch || "";
  inspectorThreadId.textContent = state.threadId || "No active thread";
  const provider = providerStatus(state.config, state.threadMeta.modelProvider);
  providerSummary.textContent = provider.name;
  const usedPercent = context.usedPercent ?? 0;
  contextMeterFill.style.width = `${Math.min(100, Math.max(0, usedPercent))}%`;
  contextDetail.textContent = context.windowSize
    ? `${formatNumber(context.contextUsed)} used · ${formatNumber(Math.max(0, context.windowSize - context.contextUsed))} remaining · ${formatNumber(context.windowSize)} limit`
    : "Usage unavailable";
  const initials = accountLabel().split(/[@\s._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  $("#accountButton").textContent = initials;
  const navIndex = state.navigation.index;
  $("#backThreadButton").disabled = navIndex <= 0 || state.running;
  $("#forwardThreadButton").disabled = navIndex < 0 || navIndex >= state.navigation.items.length - 1 || state.running;
  renderThreadList();
}

function createThreadUiState() {
  return {
    rightPanelTab: "outline",
    activeOutlineMessageId: null,
    expandedFileChanges: [],
    expandedDiffFiles: [],
    scrollTop: 0,
  };
}

function threadUiStorageKey(threadId) {
  return `codexThreadUi:${threadId}`;
}

function readThreadUi(threadId) {
  const fallback = createThreadUiState();
  if (!threadId) return fallback;
  try {
    const stored = JSON.parse(sessionStorage.getItem(threadUiStorageKey(threadId)) || "null");
    return {
      ...fallback,
      ...(stored && typeof stored === "object" ? stored : {}),
      expandedFileChanges: Array.isArray(stored?.expandedFileChanges) ? stored.expandedFileChanges : [],
      expandedDiffFiles: Array.isArray(stored?.expandedDiffFiles) ? stored.expandedDiffFiles : [],
    };
  } catch {
    return fallback;
  }
}

function saveThreadUi() {
  if (!state.threadId) return;
  if (state.threadUiSaveTimer !== null) {
    clearTimeout(state.threadUiSaveTimer);
    state.threadUiSaveTimer = null;
  }
  const ui = state.threadUi || createThreadUiState();
  state.threadUi = {
    ...ui,
    activeOutlineMessageId: state.activeOutlineMessageId,
    expandedFileChanges: [...state.expandedFileChanges],
    expandedDiffFiles: [...state.expandedDiffFiles],
    scrollTop: chat.scrollTop,
  };
  sessionStorage.setItem(threadUiStorageKey(state.threadId), JSON.stringify(state.threadUi));
  sessionStorage.setItem(`codexScroll:${state.threadId}`, String(chat.scrollTop));
}

function scheduleThreadUiSave() {
  if (!state.threadId) return;
  if (state.threadUiSaveTimer !== null) clearTimeout(state.threadUiSaveTimer);
  state.threadUiSaveTimer = setTimeout(() => {
    state.threadUiSaveTimer = null;
    saveThreadUi();
  }, 180);
}

function activateThreadUi(threadId) {
  state.threadUi = readThreadUi(threadId);
  state.expandedFileChanges = new Set(state.threadUi.expandedFileChanges);
  state.expandedDiffFiles = new Set(state.threadUi.expandedDiffFiles);
  state.activeOutlineMessageId = state.threadUi.activeOutlineMessageId || null;
  setInspectorTab(state.threadUi.rightPanelTab || "outline", false);
}

function setInspectorTab(tab, persist = true) {
  const next = tab === "session" ? "session" : "outline";
  const isOutline = next === "outline";
  outlinePanel.classList.toggle("hidden", !isOutline);
  sessionPanel.classList.toggle("hidden", isOutline);
  outlineTab.classList.toggle("active", isOutline);
  sessionTab.classList.toggle("active", !isOutline);
  outlineTab.setAttribute("aria-selected", String(isOutline));
  sessionTab.setAttribute("aria-selected", String(!isOutline));
  inspectorTitle.textContent = isOutline ? "对话目录" : "Session";
  if (state.threadUi) state.threadUi.rightPanelTab = next;
  if (persist) saveThreadUi();
}

function outlineSummary(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  if (!firstLine) return "Untitled message";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61).trimEnd()}...` : firstLine;
}

function setActiveOutlineMessage(messageId, persist = true) {
  state.activeOutlineMessageId = messageId || null;
  for (const item of conversationOutline.querySelectorAll(".outline-item")) {
    const active = item.dataset.messageId === state.activeOutlineMessageId;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "true" : "false");
  }
  if (persist) scheduleThreadUiSave();
}

function observeOutlineMessages() {
  state.outlineObserver?.disconnect();
  if (!("IntersectionObserver" in window)) return;
  state.outlineObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    const messageId = visible[0]?.target?.dataset.messageId;
    if (messageId) setActiveOutlineMessage(messageId);
  }, {
    root: chat,
    rootMargin: "-24px 0px -62% 0px",
    threshold: [0, 0.15, 0.5, 1],
  });
  for (const record of state.messageNodes.values()) {
    if (record.role === "user") state.outlineObserver.observe(record.article);
  }
}

function renderConversationOutline() {
  conversationOutline.replaceChildren();
  const messages = [...state.messageNodes.values()].filter((record) => record.role === "user");
  outlineCount.textContent = `${messages.length} 条`;
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "outline-empty";
    empty.textContent = "当前 Thread 还没有用户消息。";
    conversationOutline.append(empty);
    state.outlineObserver?.disconnect();
    return;
  }
  messages.forEach((record, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.messageId = record.id;
    button.setAttribute("aria-current", record.id === state.activeOutlineMessageId ? "true" : "false");
    const number = document.createElement("span");
    number.className = "outline-number";
    number.textContent = String(index + 1);
    const summary = document.createElement("span");
    summary.className = "outline-summary";
    summary.textContent = outlineSummary(record.raw);
    summary.title = record.raw || "Untitled message";
    button.append(number, summary);
    button.addEventListener("click", () => {
      record.article.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveOutlineMessage(record.id);
    });
    conversationOutline.append(button);
  });
  setActiveOutlineMessage(state.activeOutlineMessageId || messages[0].id, false);
  observeOutlineMessages();
}

function renderThreadList() {
  const filtered = filterThreads(state.threads, threadSearchInput.value);
  threadList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "thread-list-empty";
    empty.textContent = state.threadListError
      ? "Recent sessions are unavailable. Resume with a Thread ID below."
      : state.threadListLoading
        ? "Loading recent conversations..."
        : threadSearchInput.value.trim()
          ? "No conversations match this search."
          : "No recent conversations yet.";
    threadList.append(empty);
  } else {
    for (const group of groupThreads(filtered)) {
      const section = document.createElement("section");
      section.className = "thread-group";
      const heading = document.createElement("h3");
      heading.className = "thread-group-title";
      heading.textContent = group.label;
      section.append(heading);

      for (const thread of group.threads) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `thread-item${thread.id === state.threadId ? " active" : ""}`;
        button.disabled = state.running;
        button.title = `${threadTitle(thread, 500)}\n${thread.cwd || thread.id}`;
        button.setAttribute("aria-current", thread.id === state.threadId ? "true" : "false");

        const title = document.createElement("span");
        title.className = "thread-item-title";
        title.textContent = threadTitle(thread);
        const time = document.createElement("time");
        time.className = "thread-item-time";
        time.textContent = formatThreadTime(thread);
        const preview = document.createElement("span");
        preview.className = "thread-item-preview";
        preview.textContent = thread.preview || "No preview";
        button.append(title, time, preview);
        button.addEventListener("click", () => {
          if (thread.id !== state.threadId) resumeThread(thread.id);
        });
        section.append(button);
      }
      threadList.append(section);
    }
  }

  threadListStatus.textContent = state.threadListError
    ? "thread/list unavailable"
    : state.threadListLoading
      ? "Refreshing..."
      : `${state.threads.length} recent`;
  loadMoreThreadsButton.classList.toggle("hidden", !state.threadListCursor);
}

function applyThreadList(result, append = false, error = null) {
  state.threadListLoading = false;
  state.threadListError = error || null;
  if (result) {
    const incoming = Array.isArray(result.data) ? result.data : [];
    state.threads = append ? mergeThreadPages(state.threads, incoming) : mergeThreadPages([], incoming);
    state.threadListCursor = result.nextCursor || null;
  } else if (!append) {
    state.threads = [];
    state.threadListCursor = null;
  }
  renderThreadList();
}

function refreshThreadList(cursor = null, searchTerm = threadSearchInput.value.trim()) {
  state.threadListLoading = true;
  state.threadListError = null;
  renderThreadList();
  send({ type: "listThreads", cursor, searchTerm });
}

function scrollToBottom(force = false) {
  if (!force && !state.followOutput) return;
  const apply = () => {
    state.pendingScrollFrame = null;
    if (!force && !state.followOutput) return;
    chat.scrollTop = chat.scrollHeight;
    state.followOutput = true;
    jumpToBottomButton.classList.add("hidden");
  };
  if (force) {
    if (state.pendingScrollFrame !== null) cancelAnimationFrame(state.pendingScrollFrame);
    apply();
  } else if (state.pendingScrollFrame === null) {
    state.pendingScrollFrame = requestAnimationFrame(apply);
  }
}

function addSystemMessage(text, kind = "info") {
  const node = document.createElement("div");
  node.className = `system-message system-${kind}`;
  node.textContent = text;
  chat.append(node);
  scrollToBottom();
}

function renderMarkdown(node, raw) {
  const extracted = extractMath(raw || "");
  const html = marked.parse(extracted.markdown);
  node.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-codex-math"],
  });
  renderMathSlots(node, extracted.formulas, katex);
}

function scheduleRender(record) {
  if (state.renderTimers.has(record.id)) return;
  const timer = setTimeout(() => {
    renderMarkdown(record.content, record.raw);
    record.renderedRaw = record.raw;
    state.renderTimers.delete(record.id);
    scrollToBottom();
  }, 80);
  state.renderTimers.set(record.id, timer);
}

function ensureMessage(id, role, meta = {}) {
  let record = state.messageNodes.get(id);
  if (record) return record;

  $("#chatEmptyState")?.remove();
  const article = document.createElement("article");
  article.className = `message message-${role}`;
  article.dataset.messageId = id;
  article.id = `message-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const head = document.createElement("div");
  head.className = "message-head";
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "Y" : "C";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Codex";
  const time = document.createElement("time");
  time.className = "message-time";
  const timestamp = Number(meta.startedAt || state.currentTurn?.startedAt || 0);
  time.textContent = timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000)) : "";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "icon-button message-copy";
  copy.title = "Copy message";
  copy.setAttribute("aria-label", "Copy message");
  const icon = document.createElement("i");
  icon.dataset.icon = "copy";
  copy.append(icon);
  const content = document.createElement("div");
  content.className = "message-content markdown-body";
  copy.addEventListener("click", () => navigator.clipboard.writeText(record?.raw || ""));
  head.append(avatar, label, time, copy);
  article.append(head, content);
  chat.append(article);
  renderIcons(head);

  record = { id, role, raw: "", article, content, time };
  state.messageNodes.set(id, record);
  if (role === "user") renderConversationOutline();
  return record;
}

function addLocalUserMessage(input) {
  const id = `local-user-${crypto.randomUUID()}`;
  const record = ensureMessage(id, "user");
  record.raw = Array.isArray(input) ? displayInput(input) : String(input || "");
  renderMarkdown(record.content, record.raw);
  renderConversationOutline();
  scrollToBottom(true);
}

function toolTitle(item) {
  switch (item.type) {
    case "commandExecution":
      return `Command / ${item.status || "inProgress"} / ${item.command || ""}`;
    case "fileChange":
      return `File change / ${item.status || "inProgress"}`;
    case "mcpToolCall":
      return `MCP / ${item.server || ""}/${item.tool || ""} / ${item.status || ""}`;
    default:
      return `${item.type || "tool"} / ${item.status || ""}`;
  }
}

function filePathParts(filePath) {
  const full = String(filePath || "");
  const cwd = String(currentCwd() || "").replace(/[\\/]+$/, "");
  const relative = cwd && full.startsWith(`${cwd}/`) ? full.slice(cwd.length + 1) : full;
  const parts = relative.split(/[\\/]/).filter(Boolean);
  return { full, relative: relative || full, name: parts.at(-1) || relative || full || "Unknown file" };
}

function fileChangeLabel(count) {
  return `${count} file${count === 1 ? "" : "s"} changed`;
}

function setFileChangeExpanded(record, item, expanded) {
  if (expanded) {
    state.expandedFileChanges.add(item.id);
    const files = normalizeFileChanges(item);
    if (files.length && ![...state.expandedDiffFiles].some((key) => key.startsWith(`${item.id}:`))) {
      state.expandedDiffFiles.add(`${item.id}:${files[0].id}`);
    }
  } else {
    state.expandedFileChanges.delete(item.id);
  }
  record.details.classList.toggle("expanded", expanded);
  record.body.hidden = !expanded;
  saveThreadUi();
}

function ensureTool(item) {
  let record = state.toolNodes.get(item.id);
  if (record) return record;
  if (item.type === "fileChange") {
    const card = document.createElement("section");
    card.className = "tool-card file-change-card";
    const header = document.createElement("div");
    header.className = "tool-card-head";
    header.textContent = toolTitle(item);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "file-change-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const preview = document.createElement("div");
    preview.className = "file-change-preview";
    const body = document.createElement("div");
    body.className = "file-change-body";
    card.append(header, toggle, preview, body);
    chat.append(card);
    record = { details: card, summary: toggle, header, preview, body, item, fileList: null };
    toggle.addEventListener("click", () => {
      setFileChangeExpanded(record, item, !state.expandedFileChanges.has(item.id));
      renderToolFileChange(record, item);
      toggle.setAttribute("aria-expanded", String(state.expandedFileChanges.has(item.id)));
    });
    state.toolNodes.set(item.id, record);
    return record;
  }
  const details = document.createElement("details");
  details.className = "tool-card";
  const summary = document.createElement("summary");
  summary.textContent = toolTitle(item);
  const body = document.createElement("pre");
  body.className = "tool-output";
  body.textContent = item.aggregatedOutput || "";
  details.append(summary, body);
  chat.append(details);
  record = { details, summary, body, item };
  state.toolNodes.set(item.id, record);
  return record;
}

function renderDiffFileIfNeeded(details, container, file) {
  if (details.open && !container.childElementCount) renderDiffRows(container, file);
}

function renderToolFileChange(record, item) {
  record.body.replaceChildren();
  record.preview.replaceChildren();
  const files = normalizeFileChanges(item);
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "tool-file-empty";
    empty.textContent = "No file patch was reported.";
    record.preview.append(empty);
    record.body.hidden = !state.expandedFileChanges.has(item.id);
    return;
  }
  for (const file of files) {
    const parts = filePathParts(file.path);
    const row = document.createElement("div");
    row.className = "file-change-preview-row";
    const name = document.createElement("strong");
    name.className = "file-change-preview-name";
    name.textContent = parts.name;
    name.title = parts.full;
    const relative = document.createElement("span");
    relative.className = "file-change-preview-path";
    relative.textContent = parts.relative === parts.name ? "" : parts.relative;
    row.append(name, relative);
    record.preview.append(row);
  }
  const fileList = document.createElement("div");
  fileList.className = "tool-file-list";
  for (const [index, file] of files.entries()) {
    const key = `${item.id}:${file.id}`;
    const details = document.createElement("details");
    details.className = "tool-file";
    details.open = state.expandedDiffFiles.has(key) || (state.expandedFileChanges.has(item.id) && index === 0 && ![...state.expandedDiffFiles].some((value) => value.startsWith(`${item.id}:`)));
    details.addEventListener("toggle", () => {
      if (details.open) state.expandedDiffFiles.add(key);
      else state.expandedDiffFiles.delete(key);
      renderDiffFileIfNeeded(details, diff, file);
      saveThreadUi();
    });
    const summary = document.createElement("summary");
    const path = document.createElement("strong");
    path.className = "tool-file-path";
    const parts = filePathParts(file.path);
    path.textContent = parts.name;
    path.title = parts.full;
    const stats = document.createElement("span");
    stats.className = "tool-file-stats";
    stats.textContent = `+${file.additions} / -${file.deletions}`;
    summary.append(path, stats);
    const diff = document.createElement("div");
    diff.className = "tool-file-diff";
    details.append(summary, diff);
    fileList.append(details);
    renderDiffFileIfNeeded(details, diff, file);
  }
  record.body.append(fileList);
  record.fileList = fileList;
  const expanded = state.expandedFileChanges.has(item.id);
  record.details.classList.toggle("expanded", expanded);
  record.body.hidden = !expanded;
  record.summary.setAttribute("aria-expanded", String(expanded));
  record.summary.replaceChildren();
  const chevron = document.createElement("span");
  chevron.className = "file-change-chevron";
  chevron.textContent = "›";
  const label = document.createElement("span");
  label.className = "file-change-label";
  label.textContent = fileChangeLabel(files.length);
  const added = document.createElement("span");
  added.className = "file-change-stat-add";
  added.textContent = `+${files.reduce((sum, file) => sum + file.additions, 0)}`;
  const removed = document.createElement("span");
  removed.className = "file-change-stat-del";
  removed.textContent = `-${files.reduce((sum, file) => sum + file.deletions, 0)}`;
  record.summary.append(chevron, label, added, removed);
}

function scheduleArtifactRender(view) {
  if (state.activeView !== view || state.viewRenderTimers.has(view)) return;
  const timer = setTimeout(() => {
    state.viewRenderTimers.delete(view);
    if (state.activeView === view) {
      if (view === "commands") renderCommandsView();
      else if (view === "changes") renderChangesView();
    }
  }, 80);
  state.viewRenderTimers.set(view, timer);
}

function flushToolOutput(itemId, record, item) {
  const pending = state.toolOutputTimers.get(itemId);
  if (pending) {
    clearTimeout(pending);
    state.toolOutputTimers.delete(itemId);
  }
  record.body.textContent = item.aggregatedOutput || "";
}

function updateTool(item) {
  const record = ensureTool(item);
  record.item = item;
  if (item.type === "fileChange") {
    record.header.textContent = toolTitle(item);
    renderToolFileChange(record, item);
  } else if (item.aggregatedOutput !== undefined) {
    record.summary.textContent = toolTitle(item);
    flushToolOutput(item.id, record, item);
  } else {
    record.summary.textContent = toolTitle(item);
    record.body.textContent = JSON.stringify(item, null, 2);
  }
  if (item.type === "commandExecution") {
    state.commandItems.set(item.id, item);
    if (state.activeView === "commands") renderCommandsView();
  }
  if (item.type === "fileChange") {
    state.changeItems.set(item.id, item);
    if (state.activeView === "changes") renderChangesView();
  }
}

function appendToolOutput(itemId, delta) {
  const record = state.toolNodes.get(itemId);
  if (!record) return;
  const text = delta || "";
  const item = state.commandItems.get(itemId);
  if (!item) {
    record.body.textContent += text;
    scrollToBottom();
    return;
  }
  item.aggregatedOutput = `${item.aggregatedOutput || ""}${text}`;
  if (!state.toolOutputTimers.has(itemId)) {
    const timer = setTimeout(() => {
      state.toolOutputTimers.delete(itemId);
      record.body.textContent = item.aggregatedOutput || "";
      scheduleArtifactRender("commands");
    }, 80);
    state.toolOutputTimers.set(itemId, timer);
  }
  scheduleArtifactRender("commands");
  scrollToBottom();
}

function durationLabel(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "--";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function latestUserText() {
  const turn = state.threadView.latestTurn;
  return state.latestUserInput || turn?.items?.find((item) => item.role === "user")?.text || "Latest turn";
}

function renderDiffRows(container, file, page = 1) {
  const visible = visibleDiffRows(file.rows, page);
  const scroll = document.createElement("div");
  scroll.className = "diff-scroll";
  for (const row of visible.rows) {
    const line = document.createElement("div");
    line.className = `diff-line ${row.type}`;
    const marker = document.createElement("span");
    marker.className = "line-marker";
    marker.textContent = diffRowMarker(row.type);
    marker.setAttribute("aria-hidden", "true");
    const oldNumber = document.createElement("span");
    oldNumber.className = "line-number";
    oldNumber.textContent = row.oldLine ?? "";
    const newNumber = document.createElement("span");
    newNumber.className = "line-number";
    newNumber.textContent = row.newLine ?? "";
    const code = document.createElement("span");
    code.className = "line-code";
    code.textContent = row.type === "addition" || row.type === "deletion"
      ? row.text.slice(1)
      : row.type === "context" && row.text.startsWith(" ")
        ? row.text.slice(1)
        : row.text;
    line.append(marker, oldNumber, newNumber, code);
    scroll.append(line);
  }
  container.append(scroll);
  if (visible.hasMore) {
    const load = document.createElement("button");
    load.type = "button";
    load.className = "load-diff";
    load.textContent = `Load 400 more lines (${file.lineCount - visible.rows.length} remaining)`;
    load.addEventListener("click", () => {
      container.replaceChildren();
      renderDiffRows(container, file, page + 1);
    });
    container.append(load);
  }
}

function renderChangesView() {
  let files = [...state.changeItems.values()].flatMap((item) => normalizeFileChanges(item));
  if (!files.length && state.turnDiff) files = normalizeFileChanges([], state.turnDiff);
  changesList.replaceChildren();
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  changesStats.innerHTML = `+${additions} <span>-${deletions}</span>`;
  const turn = state.threadView.latestTurn || state.currentTurn;
  const started = Number(turn?.startedAt);
  const startedLabel = started ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(started * 1000)) : "";
  changesTurnSummary.textContent = files.length
    ? `${latestUserText()}${startedLabel ? ` · ${startedLabel}` : ""} · ${turn?.status || state.threadStatus}${turn?.durationMs != null ? ` · ${durationLabel(turn.durationMs)}` : ""}`
    : "No file changes in this thread.";
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "artifact-empty";
    empty.textContent = "File changes from this thread will appear here.";
    changesList.append(empty);
    return;
  }
  files.forEach((file, index) => {
    const details = document.createElement("details");
    details.className = "file-card";
    details.open = index === 0;
    const summary = document.createElement("summary");
    const titleWrap = document.createElement("span");
    titleWrap.className = "artifact-path-wrap";
    const title = document.createElement("strong");
    title.className = "artifact-title";
    const fileParts = filePathParts(file.path);
    title.textContent = fileParts.name;
    title.title = fileParts.full;
    const path = document.createElement("span");
    path.className = "artifact-path";
    path.textContent = fileParts.relative === fileParts.name ? "" : fileParts.relative;
    path.title = fileParts.full;
    titleWrap.append(title, path);
    const kind = document.createElement("span");
    kind.className = "artifact-kind";
    kind.textContent = file.kind;
    const metric = document.createElement("span");
    metric.className = "artifact-metric";
    metric.textContent = `+${file.additions} / -${file.deletions}`;
    const body = document.createElement("div");
    summary.append(titleWrap, kind, metric);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (details.open && !body.childElementCount) renderDiffRows(body, file);
    });
    if (details.open) renderDiffRows(body, file);
    changesList.append(details);
  });
}

function renderCommandsView() {
  const items = [...state.commandItems.values()];
  commandsList.replaceChildren();
  commandsSummary.textContent = items.length ? `${items.length} command${items.length === 1 ? "" : "s"} recorded` : "No commands in this thread.";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "artifact-empty";
    empty.textContent = "Commands run by Codex will appear here.";
    commandsList.append(empty);
    return;
  }
  for (const item of items) {
    const details = document.createElement("details");
    details.className = "command-card";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.className = "artifact-title";
    title.textContent = item.command || "Command";
    title.title = item.command || "";
    const status = document.createElement("span");
    status.className = "artifact-metric";
    status.textContent = item.status || "unknown";
    const duration = document.createElement("span");
    duration.className = "artifact-metric";
    duration.textContent = durationLabel(item.durationMs);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "text-button";
    copy.textContent = "Copy";
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      navigator.clipboard.writeText(item.aggregatedOutput || item.command || "");
    });
    summary.append(title, status, duration, copy);
    const meta = document.createElement("div");
    meta.className = "command-meta";
    for (const value of [`cwd: ${item.cwd || "--"}`, `exit: ${item.exitCode ?? "--"}`, `status: ${item.status || "unknown"}`]) {
      const span = document.createElement("span");
      span.textContent = value;
      meta.append(span);
    }
    const output = document.createElement("pre");
    output.className = "command-output";
    output.textContent = item.aggregatedOutput || "No aggregated output.";
    details.append(summary, meta, output);
    commandsList.append(details);
  }
}

function removeApproval(requestId) {
  state.approvals = state.approvals.filter((entry) => String(entry.id) !== String(requestId));
}

function addApproval(message) {
  const { id, method, params = {} } = message;
  state.approvals.push(message);
  const card = document.createElement("section");
  card.className = "approval-card";
  card.dataset.requestId = String(id);
  const title = document.createElement("strong");
  title.textContent = method.includes("fileChange") ? "Codex requests a file change" : "Codex requests an operation";
  const description = document.createElement("pre");
  description.textContent = params.command || params.reason || JSON.stringify(params, null, 2);
  const actions = document.createElement("div");
  actions.className = "approval-actions";

  for (const [decision, label] of [["accept", "Allow once"], ["acceptForSession", "Allow for session"], ["decline", "Decline"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (decision === "decline") button.className = "secondary";
    button.addEventListener("click", () => {
      send({ type: "approval", requestId: id, decision });
      removeApproval(id);
      card.remove();
    });
    actions.append(button);
  }
  card.append(title, description, actions);
  approvalArea.append(card);
}

function restoreHistory(thread) {
  state.threadView = normalizeThread(thread);
  state.latestUserInput = state.threadView.latestTurn?.items?.find((item) => item.role === "user")?.text || "";
  syncTurnActivityFromThread(thread);
  state.commandItems.clear();
  state.changeItems.clear();
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = displayInput(item.content || []);
        const record = ensureMessage(item.id, "user", turn);
        record.raw = text;
        renderMarkdown(record.content, text);
      } else if (item.type === "agentMessage") {
        const record = ensureMessage(item.id, "assistant", turn);
        record.raw = item.text || "";
        renderMarkdown(record.content, record.raw);
      } else if (["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) {
        updateTool(item);
      }
    }
  }
  if (state.activeView === "changes") renderChangesView();
  if (state.activeView === "commands") renderCommandsView();
  renderConversationOutline();
  requestAnimationFrame(() => {
    const saved = Number(state.threadUi?.scrollTop || sessionStorage.getItem(`codexScroll:${thread?.id}`));
    if (Number.isFinite(saved) && saved > 0) {
      chat.scrollTop = saved;
      state.followOutput = shouldFollowScroll(chat);
    } else {
      scrollToBottom(true);
    }
  });
}

function mergeThreadSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  const effort = resolveReasoningEffort(settings);
  state.threadMeta = { ...state.threadMeta, ...settings };
  const model = settings.model || settings.modelId;
  const tier = settings.serviceTier;
  if (model) {
    populateModels(model);
    if (effort) populateEfforts(effort);
    if (tier !== undefined) populateTiers(tier || "");
  } else {
    if (effort) populateEfforts(effort);
    if (tier !== undefined) populateTiers(tier || "");
  }
  if (settings.permissions !== undefined || settings.activePermissionProfile || settings.permissionProfile) {
    populatePermissions(settings.permissions || settings.activePermissionProfile?.id || settings.permissionProfile?.id || settings.permissionProfile || "");
  }
  if (settings.cwd) cwdInput.value = settings.cwd;
  saveControlPreferences();
  updateControls();
}

function handleCodex(message) {
  const method = message.method;
  const params = message.params || {};

  if (message.id !== undefined) {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      addApproval(message);
      return;
    }
    addSystemMessage(`Unsupported App Server request declined: ${method}`, "warning");
    send({ type: "approval", requestId: message.id, decision: "decline" });
    return;
  }

  switch (method) {
    case "thread/status/changed":
      if (!params.threadId || params.threadId === state.threadId) {
        const value = params.status;
        state.threadStatus = normalizeThreadStatus(value);
        state.running = state.threadStatus === "active" || Boolean(value?.activeFlags?.length);
        if (state.running) setTurnActivityWorking(params.startedAt || value?.startedAt);
        else if (state.activityMode === "working") setTurnActivityWorked({ status: state.threadStatus, completedAt: params.completedAt || value?.completedAt });
        updateControls();
      }
      break;

    case "thread/tokenUsage/updated":
      if (!state.threadId || !params.threadId || params.threadId === state.threadId) {
        state.tokenUsage = params.tokenUsage || params.token_usage || null;
        state.tokenUsageThreadId = params.threadId || state.threadId;
        updateControls();
      }
      break;

    case "thread/settings/updated":
      mergeThreadSettings(params.threadSettings || params.settings || params);
      addSystemMessage("Thread settings synchronized.");
      break;

    case "mcpServerStatus/updated":
      if (params.name) {
        state.mcpStartupStatuses[params.name] = {
          status: params.status,
          error: params.error || params.failureReason || null,
        };
      }
      break;

    case "item/guardianApprovalReview/completed":
      if (!params.threadId || params.threadId === state.threadId) {
        const event = guardianEventFromNotification(params);
        if (!event) break;
        state.latestGuardianDenial = event;
        addSystemMessage("Auto-review denied an action. Use /approve to authorize one retry.", "warning");
      }
      break;

    case "turn/started":
      state.running = true;
      state.threadStatus = "active";
      state.activeTurnId = params.turn?.id || state.activeTurnId;
      state.currentTurn = params.turn || { id: state.activeTurnId, status: "inProgress", startedAt: Math.floor(Date.now() / 1000) };
      setTurnActivityWorking(state.currentTurn.startedAt);
      updateControls();
      break;

    case "turn/completed": {
      const completedTurn = {
        ...(state.currentTurn || {}),
        ...(params.turn || {}),
        status: params.turn?.status || "completed",
      };
      const activityStartedAt = state.activityStartedAtMs;
      state.running = false;
      state.threadStatus = "idle";
      state.activeTurnId = null;
      const status = completedTurn.status;
      state.currentTurn = completedTurn;
      if (state.currentTurn) {
        state.threadView.latestTurn = state.currentTurn;
        state.threadView.turns.push(state.currentTurn);
      }
      setTurnActivityWorked(completedTurn, activityStartedAt);
      if (status !== "completed") addSystemMessage(`Turn status: ${status}`, status === "failed" ? "error" : "warning");
      updateControls();
      refreshThreadList();
      messageInput.focus();
      break;
    }

    case "item/started": {
      const item = params.item;
      if (item && ["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) updateTool(item);
      break;
    }

    case "item/agentMessage/delta": {
      const id = params.itemId;
      if (!id) break;
      const record = ensureMessage(id, "assistant");
      record.raw += params.delta || "";
      scheduleRender(record);
      break;
    }

    case "item/commandExecution/outputDelta":
      appendToolOutput(params.itemId, params.delta);
      break;

    case "item/completed": {
      const item = params.item;
      if (!item) break;
      if (item.type === "agentMessage") {
        const record = ensureMessage(item.id, "assistant");
        const pendingRender = state.renderTimers.get(item.id);
        if (pendingRender) {
          clearTimeout(pendingRender);
          state.renderTimers.delete(item.id);
        }
        record.raw = item.text || record.raw;
        renderMarkdown(record.content, record.raw);
        record.renderedRaw = record.raw;
      } else if (["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) {
        updateTool(item);
      }
      scrollToBottom();
      break;
    }

    case "turn/diff/updated":
      state.latestDiff = params.diff || params.unifiedDiff || JSON.stringify(params, null, 2);
      state.turnDiff = state.latestDiff;
      if (state.activeView === "changes") renderChangesView();
      break;

    case "item/fileChange/patchUpdated": {
      const existing = state.changeItems.get(params.itemId) || { id: params.itemId, type: "fileChange", status: "inProgress" };
      existing.changes = params.changes || [];
      updateTool(existing);
      break;
    }

    case "model/rerouted":
      if (params.model) {
        state.threadMeta.model = params.model;
        populateModels(params.model);
        addSystemMessage(`Model rerouted to ${params.model}.`, "warning");
        updateControls();
      }
      break;

    case "error":
      addSystemMessage(params.error?.message || params.message || "Codex error", "error");
      break;

    case "warning":
      addSystemMessage(params.message || "Codex warning", "warning");
      break;

    default:
      break;
  }
}

function applyThreadResponse(payload) {
  if (state.threadId && state.threadId !== payload.thread.id) saveThreadUi();
  state.threadId = payload.thread.id;
  activateThreadUi(state.threadId);
  if (state.tokenUsageThreadId !== state.threadId) {
    state.tokenUsage = null;
    state.tokenUsageThreadId = null;
  }
  state.activeTurnId = null;
  state.running = false;
  state.threadStatus = normalizeThreadStatus(payload.thread?.status || "idle");
  clearTurnActivity();
  const reasoningEffort = resolveReasoningEffort(payload) || resolveReasoningEffort(payload.thread);
  state.threadMeta = {
    name: payload.thread?.name,
    model: payload.model || payload.thread?.model,
    modelProvider: payload.modelProvider || payload.thread?.modelProvider,
    serviceTier: payload.serviceTier || payload.thread?.serviceTier,
    cwd: payload.cwd || payload.thread?.cwd || cwdInput.value,
    instructionSources: payload.instructionSources || payload.thread?.instructionSources || [],
    approvalPolicy: payload.approvalPolicy || payload.thread?.approvalPolicy,
    sandbox: payload.sandbox || payload.thread?.sandbox,
    permissionProfile: payload.permissionProfile || payload.activePermissionProfile,
    activePermissionProfile: payload.activePermissionProfile,
    permissions: payload.permissions,
    reasoningEffort,
    gitInfo: payload.thread?.gitInfo || null,
  };

  if (!state.navigatingHistory) state.navigation = pushThreadNavigation(state.navigation, state.threadId);
  state.navigatingHistory = false;

  localStorage.setItem("codexMathThreadId", state.threadId);
  threadIdInput.value = state.threadId;
  if (state.threadMeta.cwd) {
    cwdInput.value = state.threadMeta.cwd;
    localStorage.setItem("codexMathCwd", state.threadMeta.cwd);
  }

  populateModels(state.threadMeta.model);
  populateEfforts(state.threadMeta.reasoningEffort);
  populateTiers(state.threadMeta.serviceTier || "");
  populatePermissions(activePermissionId());
  saveControlPreferences();
}

function openTextDialog(title, content) {
  textDialogTitle.textContent = title;
  textDialogBody.textContent = content || "No data.";
  textDialog.showModal();
}

function accountLabel() {
  const account = state.account?.account || state.account;
  if (!account) return "unknown";
  return account.email || account.name || account.type || account.authMode || JSON.stringify(account);
}

function permissionLabel() {
  return state.threadMeta.activePermissionProfile?.name
    || state.threadMeta.permissionProfile?.name
    || state.threadMeta.permissionProfile
    || state.threadMeta.permissions
    || state.threadMeta.sandbox?.type
    || state.threadMeta.sandbox
    || "default";
}

function showStatus() {
  const context = contextStats();
  const provider = providerStatus(state.config, state.threadMeta.modelProvider);
  const fields = [
    ["Codex CLI", `v${codexVersion(state.serverInfo)}`],
    ["Model", currentModelLabel()],
    ["Reasoning", displayEffortLabel()],
    ["Model provider", provider.name],
    ["Provider URL", provider.url],
    ["Service tier", currentTierLabel()],
    ["Directory", currentCwd()],
    ["Permissions", permissionLabel()],
    ["Approval policy", state.threadMeta.approvalPolicy || "default"],
    ["Collaboration mode", state.threadMeta.collaborationMode?.mode || state.threadMeta.collaborationMode || "Default"],
    ["Thread state", state.threadStatus],
    ["Session", state.threadId || "none"],
    ["Account", accountLabel()],
    ["Token usage", context.totalUsed ? `${formatNumber(context.totalUsed)} total (${formatNumber(context.input)} input + ${formatNumber(context.output)} output)` : "--"],
    ["Context window", context.leftPercent === null ? "unknown" : `${context.leftPercent.toFixed(0)}% left (${formatNumber(context.contextUsed)} used / ${formatNumber(context.windowSize)})`],
    ["Instruction sources", Array.isArray(state.threadMeta.instructionSources) ? state.threadMeta.instructionSources.join(", ") : JSON.stringify(state.threadMeta.instructionSources || [])],
  ];

  statusGrid.replaceChildren();
  for (const [label, value] of fields) {
    const row = document.createElement("div");
    const dt = document.createElement("div");
    dt.className = "status-key";
    dt.textContent = label;
    const dd = document.createElement("div");
    dd.className = "status-value";
    dd.textContent = typeof value === "string" ? value : JSON.stringify(value);
    row.append(dt, dd);
    statusGrid.append(row);
  }

  statusSubtitle.textContent = `${currentModelLabel()} / ${displayEffortLabel()} / ${state.threadStatus}`;
  rawStatus.textContent = JSON.stringify({
    threadMeta: state.threadMeta,
    tokenUsage: state.tokenUsage,
    account: state.account,
    config: state.config,
    permissionProfiles: state.permissionProfiles,
    experiments: state.experiments,
    metadataErrors: state.metadataErrors,
    serverInfo: state.serverInfo,
  }, null, 2);
  statusDialog.showModal();
}

function clearPendingRenderTimers() {
  for (const timer of state.renderTimers.values()) clearTimeout(timer);
  for (const timer of state.toolOutputTimers.values()) clearTimeout(timer);
  for (const timer of state.viewRenderTimers.values()) clearTimeout(timer);
  state.renderTimers.clear();
  state.toolOutputTimers.clear();
  state.viewRenderTimers.clear();
  if (state.threadUiSaveTimer !== null) {
    clearTimeout(state.threadUiSaveTimer);
    state.threadUiSaveTimer = null;
  }
  if (state.pendingScrollFrame !== null) {
    cancelAnimationFrame(state.pendingScrollFrame);
    state.pendingScrollFrame = null;
  }
}

function clearTranscript(showNotice = true) {
  clearPendingRenderTimers();
  chat.replaceChildren();
  state.messageNodes.clear();
  state.toolNodes.clear();
  state.latestDiff = "";
  if (showNotice) addSystemMessage("Browser transcript cleared. Codex context was not changed.", "warning");
}

function startNewThread(sessionStartSource = null) {
  const cwd = cwdInput.value.trim();
  if (!cwd) {
    addSystemMessage("Enter a WSL project directory first.", "error");
    return;
  }
  localStorage.setItem("codexMathCwd", cwd);
  saveControlPreferences();
  const settings = selectedSettings();
  send({ type: "startThread", cwd, sessionStartSource, ...settings });
}

function resumeThread(threadId = threadIdInput.value.trim()) {
  if (!threadId) {
    addSystemMessage("A thread ID is required.", "error");
    return;
  }
  send({ type: "resumeThread", threadId });
}

function updateThreadSettings() {
  saveControlPreferences();
  if (!state.threadId) {
    updateControls();
    return;
  }
  send({ type: "updateSettings", ...selectedSettings() });
}

function copyLatestAssistant() {
  const records = [...state.messageNodes.values()].filter((record) => record.role === "assistant");
  const latest = records.at(-1);
  if (!latest) {
    addSystemMessage("No assistant response to copy.", "warning");
    return;
  }
  navigator.clipboard.writeText(latest.raw).then(
    () => addSystemMessage("Latest assistant response copied."),
    (error) => addSystemMessage(`Clipboard error: ${error.message}`, "error"),
  );
}

function preferredFastTier() {
  const tiers = [...tierSelect.options].map((option) => option.value).filter(Boolean);
  return tiers.find((tier) => /fast|priority/i.test(tier)) || null;
}

function setModelAndEffort(model, effort) {
  if (model) {
    const exists = [...modelSelect.options].some((option) => option.value === model);
    if (!exists) {
      addSystemMessage(`Unknown model: ${model}`, "error");
      return false;
    }
    modelSelect.value = model;
    populateEfforts(effort);
    populateTiers(tierSelect.value);
  }
  if (effort) {
    const exists = [...effortSelect.options].some((option) => option.value === effort);
    if (!exists) {
      addSystemMessage(`Reasoning effort '${effort}' is not listed for ${modelSelect.value}.`, "error");
      return false;
    }
    effortSelect.value = effort;
  }
  updateThreadSettings();
  return true;
}

function showExperiments() {
  if (!state.experiments.length) {
    openTextDialog("Experimental features", "No feature list was returned by this Codex version/provider.");
    return;
  }
  const lines = state.experiments.map((feature) => {
    const name = feature.name || feature.id || "unknown";
    const stage = feature.stage || "unknown";
    const enabled = feature.enabled ? "on" : "off";
    const label = feature.displayName || feature.display_name || "";
    const description = feature.description || "";
    return `${name} = ${enabled} [${stage}]${label ? ` / ${label}` : ""}${description ? `\n  ${description}` : ""}`;
  });
  openTextDialog("Experimental features", lines.join("\n\n"));
}

function showChoicePalette(title, items) {
  if (!items.length) {
    addSystemMessage(`${title}: no options are available.`, "warning");
    return;
  }
  state.choicePalette = { title, items };
  state.paletteIndex = 0;
  messageInput.value = "";
  renderChoicePalette();
  messageInput.focus();
}

function renderChoicePalette() {
  const chooser = state.choicePalette;
  if (!chooser) return;
  slashPalette.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "slash-heading";
  heading.textContent = chooser.title;
  slashPalette.append(heading);

  state.paletteIndex = Math.min(state.paletteIndex, chooser.items.length - 1);
  chooser.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-item choice-item${index === state.paletteIndex ? " selected" : ""}`;
    const label = document.createElement("strong");
    label.textContent = item.label;
    const detail = document.createElement("span");
    detail.textContent = item.detail || "";
    button.append(label, detail);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      choosePaletteItem(index);
    });
    slashPalette.append(button);
  });
  slashPalette.classList.remove("hidden");
  slashPalette.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function choosePaletteItem(index = state.paletteIndex) {
  const item = state.choicePalette?.items[index];
  if (!item) return;
  state.choicePalette = null;
  slashPalette.classList.add("hidden");
  item.select();
}

function showModelChoices() {
  showChoicePalette("Select model", state.models.map((model) => ({
    label: modelName(model),
    detail: modelId(model) === currentModelLabel() ? "Current model" : modelId(model),
    select: () => {
      modelSelect.value = modelId(model);
      populateEfforts();
      populateTiers();
      const efforts = modelEfforts(model);
      if (!efforts.length) {
        updateThreadSettings();
        return;
      }
      showChoicePalette("Select reasoning effort", efforts.map((effort) => ({
        label: effortId(effort),
        detail: effort?.description || (effortId(effort) === displayEffortLabel() ? "Current effort" : ""),
        select: () => {
          effortSelect.value = effortId(effort);
          updateThreadSettings();
        },
      })));
    },
  })));
}

function showPermissionChoices() {
  const options = [...permissionSelect.options].filter((option) => !option.disabled && option.value);
  showChoicePalette("Select permissions", options.map((option) => ({
    label: option.textContent,
    detail: option.value === activePermissionId() ? "Current permissions" : option.value,
    select: () => {
      permissionSelect.value = option.value;
      updateThreadSettings();
    },
  })));
}

function showSkillChoices(result) {
  const skills = valueList(result).flatMap((group) => valueList(group.skills));
  showChoicePalette("Select skill", skills.map((skill) => ({
    label: skill.name || skill.id || "unnamed",
    detail: skill.description || skill.interface?.shortDescription || skill.interface?.short_description || "",
    select: () => {
      const name = skill.name || skill.id;
      messageInput.value = name ? `$${name} ` : "";
      messageInput.focus();
    },
  })));
}


function valueList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.servers)) return value.servers;
  if (Array.isArray(value?.apps)) return value.apps;
  if (Array.isArray(value?.plugins)) return value.plugins;
  return [];
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatSkillsResult(result) {
  const groups = valueList(result);
  if (!groups.length) return JSON.stringify(result ?? { data: [] }, null, 2);
  const lines = [];
  for (const group of groups) {
    const cwd = group.cwd || currentCwd();
    lines.push(cwd);
    const skills = valueList(group.skills);
    if (!skills.length) lines.push("  (no skills)");
    for (const skill of skills) {
      const name = skill.name || skill.id || "unnamed";
      const enabled = skill.enabled === false ? "disabled" : "enabled";
      const description = skill.description || skill.interface?.shortDescription || skill.interface?.short_description || "";
      lines.push(`  - ${name} [${enabled}]${description ? `: ${description}` : ""}`);
    }
    for (const error of valueList(group.errors)) lines.push(`  ! ${textValue(error)}`);
  }
  return lines.join("\n");
}

function formatHooksResult(result) {
  const groups = valueList(result);
  if (!groups.length) return JSON.stringify(result ?? { data: [] }, null, 2);
  const lines = [];
  for (const group of groups) {
    lines.push(group.cwd || currentCwd());
    const hooks = valueList(group.hooks || group.items);
    if (!hooks.length) lines.push("  (no hooks)");
    for (const hook of hooks) {
      const name = hook.name || hook.key || hook.id || hook.event || "unnamed";
      const enabled = hook.enabled ?? hook.state?.enabled;
      const trust = hook.trustStatus || hook.trust_status || "";
      lines.push(`  - ${name}${enabled === undefined ? "" : enabled ? " [enabled]" : " [disabled]"}${trust ? ` · ${trust}` : ""}`);
    }
    for (const warning of valueList(group.warnings)) lines.push(`  ! ${textValue(warning)}`);
    for (const error of valueList(group.errors)) lines.push(`  ! ${textValue(error)}`);
  }
  return lines.join("\n");
}

function formatAppsResult(result) {
  const apps = valueList(result);
  if (!apps.length) return JSON.stringify(result ?? { data: [] }, null, 2);
  return apps.map((app) => {
    const name = app.name || app.displayName || app.id || "unnamed";
    const id = app.id && app.id !== name ? ` (${app.id})` : "";
    const enabled = app.isEnabled ?? app.enabled;
    const accessible = app.isAccessible ?? app.accessible;
    const flags = [enabled === undefined ? null : enabled ? "enabled" : "disabled", accessible === undefined ? null : accessible ? "accessible" : "not accessible"].filter(Boolean).join(", ");
    return `${name}${id}${flags ? ` [${flags}]` : ""}${app.description ? `\n  ${app.description}` : ""}`;
  }).join("\n\n");
}

function formatPluginsResult(result) {
  const plugins = valueList(result);
  if (!plugins.length) return JSON.stringify(result ?? { data: [] }, null, 2);
  return plugins.map((plugin) => {
    const name = plugin.name || plugin.displayName || plugin.id || plugin.pluginId || "unnamed";
    const installed = plugin.installed ?? plugin.isInstalled;
    const enabled = plugin.enabled ?? plugin.isEnabled;
    const marketplace = plugin.marketplaceName || plugin.marketplace || plugin.source || "";
    const flags = [installed === undefined ? null : installed ? "installed" : "not installed", enabled === undefined ? null : enabled ? "enabled" : "disabled"].filter(Boolean).join(", ");
    return `${name}${marketplace ? ` @ ${textValue(marketplace)}` : ""}${flags ? ` [${flags}]` : ""}`;
  }).join("\n");
}

function renderMcpInspector() {
  mcpInspectorList.replaceChildren();
  if (!state.mcpInventory.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No MCP servers were returned.";
    mcpInspectorList.append(empty);
    return;
  }
  for (const server of state.mcpInventory) {
    const row = document.createElement("div");
    row.className = `mcp-row ${String(server.status || "").toLowerCase()}`;
    const dot = document.createElement("span");
    dot.className = "mcp-dot";
    const name = document.createElement("strong");
    name.textContent = server.name;
    const status = document.createElement("span");
    status.textContent = server.status || (server.enabled === false ? "disabled" : `${server.tools.length} tools`);
    row.append(dot, name, status);
    mcpInspectorList.append(row);
  }
}

function executeSlash(raw) {
  const parts = raw.trim().split(/\s+/);
  const enteredCommand = parts.shift()?.toLowerCase() || "";
  const command = slashAliases.get(enteredCommand) || enteredCommand;
  const args = parts;
  const spec = slashCommands.find((entry) => entry.name === command);
  if (!spec) {
    addSystemMessage(`Unknown slash command: ${enteredCommand}. Select a complete command from the palette.`, "error");
    return true;
  }
  if (spec.unavailable) {
    addSystemMessage(`${spec.name} is a Codex CLI/TUI command, but this browser client cannot provide its required terminal or IDE UI.`, "warning");
    return true;
  }

  switch (command) {
    case "/model":
      if (!args.length) {
        showModelChoices();
      } else {
        setModelAndEffort(args[0], args[1]);
      }
      break;
    case "/status":
      showStatus();
      break;
    case "/permissions":
      if (!args.length) {
        showPermissionChoices();
      } else {
        const target = args[0];
        const exists = [...permissionSelect.options].some((option) => option.value === target && !option.disabled);
        if (!exists) addSystemMessage(`Unknown or blocked permission profile: ${target}`, "error");
        else {
          permissionSelect.value = target;
          updateThreadSettings();
        }
      }
      break;
    case "/fast": {
      const mode = (args[0] || "toggle").toLowerCase();
      const fastTier = preferredFastTier();
      if (mode === "status") {
        addSystemMessage(`Service tier: ${currentTierLabel()}`);
      } else if (mode === "off" || (mode === "toggle" && tierSelect.value)) {
        tierSelect.value = "";
        updateThreadSettings();
      } else if (fastTier) {
        tierSelect.value = fastTier;
        updateThreadSettings();
      } else {
        addSystemMessage("This model did not report a fast/priority service tier.", "warning");
      }
      break;
    }
    case "/memories": {
      const mode = (args[0] || "status").toLowerCase();
      if (mode === "status") {
        addSystemMessage(`Memory mode: ${state.threadMeta.memoryMode || "unknown"}`);
      } else if (mode === "on" || mode === "off") {
        send({ type: "setMemoryMode", mode: mode === "on" ? "enabled" : "disabled" });
      } else {
        addSystemMessage("Usage: /memories [on|off|status]", "error");
      }
      break;
    }
    case "/review":
      send({ type: "reviewThread", instructions: args.join(" ") });
      break;
    case "/rename": {
      const name = args.join(" ").trim();
      if (!name) addSystemMessage("Usage: /rename <name>", "error");
      else send({ type: "renameThread", name });
      break;
    }
    case "/archive":
      if (window.confirm("Archive the current Codex thread?")) send({ type: "archiveThread" });
      break;
    case "/delete":
      if (window.confirm("Permanently delete the current Codex thread and its descendants? This cannot be undone.")) send({ type: "deleteThread" });
      break;
    case "/goal": {
      const value = args.join(" ").trim();
      if (!value) send({ type: "getGoal" });
      else if (value.toLowerCase() === "clear") send({ type: "clearGoal" });
      else send({ type: "setGoal", objective: value });
      break;
    }
    case "/mcp": {
      const mode = (args[0] || "summary").toLowerCase();
      if (!["summary", "verbose", "reload"].includes(mode)) {
        addSystemMessage("Usage: /mcp [verbose|reload]", "error");
      } else if (mode === "reload") {
        state.mcpDialogRequested = true;
        send({ type: "reloadMcp", verbose: args[1]?.toLowerCase() === "verbose" });
      } else {
        state.mcpDialogRequested = true;
        send({ type: "listMcp", verbose: mode === "verbose" });
      }
      break;
    }
    case "/skills":
      send({ type: "listSkills", forceReload: (args[0] || "").toLowerCase() === "reload", cwd: currentCwd() });
      break;
    case "/hooks":
      send({ type: "listHooks", cwd: currentCwd() });
      break;
    case "/apps":
      send({ type: "listApps", forceRefetch: (args[0] || "").toLowerCase() === "reload" });
      break;
    case "/plugins":
      send({ type: "listPlugins" });
      break;
    case "/usage":
      send({ type: "readUsage" });
      break;
    case "/debug-config":
      openTextDialog("Config diagnostics", JSON.stringify({ config: state.config, metadataErrors: state.metadataErrors, threadMeta: state.threadMeta }, null, 2));
      break;
    case "/compact":
      send({ type: "compact" });
      break;
    case "/plan":
      if (!state.threadId) {
        addSystemMessage("Start or resume a thread before switching collaboration mode.", "error");
      } else {
        send({
          type: "updateSettings",
          collaborationMode: {
            mode: "plan",
            settings: {
              model: currentModelLabel(),
              reasoning_effort: currentEffortLabel() === "default" ? null : currentEffortLabel(),
              developer_instructions: null,
            },
          },
        });
      }
      break;
    case "/new":
      startNewThread();
      break;
    case "/resume":
      resumeThread(args[0]);
      break;
    case "/fork":
      send({ type: "forkThread" });
      break;
    case "/copy":
      copyLatestAssistant();
      break;
    case "/diff":
      openTextDialog("Latest diff", state.latestDiff || "No turn/diff/updated event has been received.");
      break;
    case "/mention":
      openMentionInput();
      break;
    case "/approve": {
      if (!state.latestGuardianDenial) {
        addSystemMessage("No recent auto-review denial is available to retry.", "warning");
      } else {
        send({ type: "approveGuardianDeniedAction", event: state.latestGuardianDenial });
      }
      break;
    }
    case "/experimental": {
      if (!args.length) {
        showExperiments();
        break;
      }
      const name = args[0];
      const feature = state.experiments.find((item) => (item.name || item.id) === name);
      if (!feature) {
        addSystemMessage(`Unknown experimental feature: ${name}`, "error");
        break;
      }
      const mode = (args[1] || "toggle").toLowerCase();
      const enabled = mode === "on" ? true : mode === "off" ? false : !Boolean(feature.enabled);
      send({ type: "setExperiment", name, enabled });
      break;
    }
    case "/ps":
      send({ type: "listBackgroundTerminals" });
      break;
    case "/stop":
      send({ type: "cleanBackgroundTerminals" });
      break;
    case "/clear":
      clearTranscript(false);
      startNewThread("clear");
      break;
    case "/personality": {
      const personality = (args[0] || "").toLowerCase();
      if (!personality) {
        showChoicePalette("Select personality", ["none", "friendly", "pragmatic"].map((value) => ({
          label: value,
          detail: value === state.threadMeta.personality ? "Current personality" : "",
          select: () => send({ type: "updateSettings", personality: value }),
        })));
      } else if (!["none", "friendly", "pragmatic"].includes(personality)) {
        addSystemMessage("Usage: /personality <none|friendly|pragmatic>", "error");
      } else if (!state.threadId) {
        addSystemMessage("Start or resume a thread before changing personality.", "error");
      } else {
        send({ type: "updateSettings", personality });
      }
      break;
    }
    case "/logout":
      if (window.confirm("Log out of Codex in this WSL environment?")) send({ type: "logout" });
      break;
    case "/quit":
    case "/exit":
      addSystemMessage("Web client disconnected. Reload the page to reconnect.");
      socket.close();
      break;
    default:
      addSystemMessage(`Not implemented: ${command}`, "warning");
  }
  return true;
}

function paletteMatches() {
  const value = messageInput.value.trimStart();
  if (!value.startsWith("/") || value.includes("\n")) return [];
  const token = value.split(/\s+/)[0].toLowerCase();
  return prioritizeSlashMatches(token, slashCommands);
}

function updateSlashPalette() {
  if (state.choicePalette) {
    renderChoicePalette();
    return;
  }
  const matches = paletteMatches();
  slashPalette.replaceChildren();
  if (!matches.length) {
    slashPalette.classList.add("hidden");
    return;
  }
  state.paletteIndex = Math.min(state.paletteIndex, matches.length - 1);
  matches.forEach((command, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-item${index === state.paletteIndex ? " selected" : ""}${command.unavailable ? " unavailable" : ""}`;
    button.innerHTML = `<strong>${command.name}</strong><span>${command.description}</span>`;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      commitPaletteSelection(command, "mouse");
    });
    slashPalette.append(button);
  });
  slashPalette.classList.remove("hidden");
}

function commitPaletteSelection(command, source = "enter") {
  const action = resolveSlashSelection(messageInput.value, command, source);
  if (action.kind === "none") return;
  messageInput.value = action.value;
  slashPalette.classList.add("hidden");
  messageInput.focus();
  if (action.kind === "submit") submitMessage();
}

function autoSizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(200, Math.max(50, messageInput.scrollHeight))}px`;
}

function mentionToken() {
  const before = messageInput.value.slice(0, messageInput.selectionStart);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? { query: match[1], start: before.length - match[1].length - 1, end: before.length } : null;
}

function renderMentionPalette() {
  mentionPalette.replaceChildren();
  if (!state.fileMatches.length) {
    mentionPalette.classList.add("hidden");
    return;
  }
  state.mentionIndex = Math.min(state.mentionIndex, state.fileMatches.length - 1);
  state.fileMatches.slice(0, 12).forEach((file, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-item${index === state.mentionIndex ? " selected" : ""}`;
    const name = document.createElement("strong");
    name.textContent = file.file_name || file.path;
    const path = document.createElement("span");
    path.textContent = file.path;
    button.append(name, path);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      chooseMention(file);
    });
    mentionPalette.append(button);
  });
  slashPalette.classList.add("hidden");
  mentionPalette.classList.remove("hidden");
}

function requestMentionSearch() {
  const token = mentionToken();
  if (!token) {
    mentionPalette.classList.add("hidden");
    return;
  }
  clearTimeout(state.mentionTimer);
  state.mentionQuery = token.query;
  state.mentionTimer = setTimeout(() => {
    if (!state.mentionQuery) {
      state.fileMatches = [];
      renderMentionPalette();
      return;
    }
    send({ type: "searchFiles", query: state.mentionQuery, cwd: currentCwd() });
  }, 140);
}

function chooseMention(file) {
  const mention = makeMention(file);
  if (!state.mentions.some((item) => item.path === mention.path)) state.mentions.push(mention);
  const token = mentionToken();
  if (token) {
    messageInput.setRangeText("", token.start, token.end, "end");
  }
  state.fileMatches = [];
  mentionPalette.classList.add("hidden");
  renderAttachmentChips();
  autoSizeComposer();
  messageInput.focus();
}

function renderAttachmentChips() {
  attachmentChips.replaceChildren();
  const entries = [
    ...state.mentions.map((mention, index) => ({ kind: "mention", index, label: `@${mention.name}`, value: mention })),
    ...state.images.map((image, index) => ({ kind: "image", index, label: image.name || `Image ${index + 1}`, value: image })),
  ];
  attachmentChips.classList.toggle("hidden", !entries.length);
  for (const entry of entries) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (entry.kind === "image") {
      const image = document.createElement("img");
      image.src = entry.value.url;
      image.alt = "";
      chip.append(image);
    }
    const label = document.createElement("span");
    label.textContent = entry.label;
    label.title = entry.value.path || entry.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${entry.label}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      if (entry.kind === "mention") state.mentions.splice(entry.index, 1);
      else state.images.splice(entry.index, 1);
      renderAttachmentChips();
    });
    chip.append(label, remove);
    attachmentChips.append(chip);
  }
}

function readImage(file) {
  validateImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve({ name: file.name, url: reader.result }));
    reader.addEventListener("error", () => reject(reader.error || new Error("Image could not be read")));
    reader.readAsDataURL(file);
  });
}

function submitMessage() {
  const text = messageInput.value.trim();
  if (state.running || (!text && !state.mentions.length && !state.images.length)) return;
  if (text.startsWith("/") && !state.mentions.length && !state.images.length) {
    messageInput.value = "";
    autoSizeComposer();
    slashPalette.classList.add("hidden");
    executeSlash(text);
    updateControls();
    return;
  }
  let input;
  try {
    input = composeUserInput(text, state.mentions, state.images);
  } catch (error) {
    addSystemMessage(error.message, "error");
    return;
  }
  messageInput.value = "";
  state.mentions = [];
  state.images = [];
  renderAttachmentChips();
  autoSizeComposer();
  slashPalette.classList.add("hidden");
  mentionPalette.classList.add("hidden");
  addLocalUserMessage(input);
  state.latestUserInput = displayInput(input);
  state.running = true;
  state.threadStatus = "active";
  setTurnActivityWorking();
  updateControls();
  if (!send({ type: "sendMessage", input, ...selectedSettings() })) {
    state.running = false;
    state.threadStatus = "idle";
    clearTurnActivity();
    updateControls();
  }
}

socket.addEventListener("open", () => setConnection("Bridge connected", true));
socket.addEventListener("close", () => {
  state.ready = false;
  state.running = false;
  clearTurnActivity();
  setConnection("Disconnected", false);
  updateControls();
});
socket.addEventListener("error", () => setConnection("WebSocket error", false));

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  switch (payload.type) {
    case "ready":
      state.ready = true;
      state.serverInfo = payload.serverInfo || null;
      state.models = payload.models || [];
      state.config = payload.config;
      state.account = payload.account;
      state.permissionProfiles = payload.permissionProfiles || [];
      state.experiments = payload.experiments || [];
      state.metadataErrors = payload.metadataErrors || {};
      applyThreadList(payload.threadList, false, payload.threadListError);
      cwdInput.value = localStorage.getItem("codexMathCwd") || payload.defaultCwd || "";
      threadIdInput.value = localStorage.getItem("codexMathThreadId") || "";
      populateModels();
      {
        const savedInspector = localStorage.getItem("codexInspectorOpen");
        const openInspector = savedInspector === "true" || (savedInspector === null && window.innerWidth >= 1360);
        inspector.classList.toggle("closed", !openInspector);
        updateBackdrop();
        if (openInspector) {
          state.mcpDialogRequested = false;
          send({ type: "listMcp", verbose: false });
        }
      }
      syncSidebarViewport();
      setConnection("Codex ready", true);
      updateControls();
      break;

    case "metadata":
      state.models = payload.models || state.models;
      state.config = payload.config ?? state.config;
      state.account = payload.account ?? state.account;
      state.permissionProfiles = payload.permissionProfiles || state.permissionProfiles;
      state.experiments = payload.experiments || state.experiments;
      state.metadataErrors = payload.metadataErrors || state.metadataErrors;
      populateModels(currentModelLabel());
      updateControls();
      break;

    case "threadReady":
      applyThreadResponse(payload);
      clearPendingRenderTimers();
      chat.replaceChildren();
      approvalArea.replaceChildren();
      state.outlineObserver?.disconnect();
      state.messageNodes.clear();
      state.toolNodes.clear();
      state.commandItems.clear();
      state.changeItems.clear();
      state.turnDiff = "";
      state.latestUserInput = "";
      state.threadView = normalizeThread(payload.thread);
      state.approvals = [];
      if (payload.mode === "resume" || payload.mode === "fork") restoreHistory(payload.thread);
      else {
        clearTurnActivity();
        if (state.activeView === "changes") renderChangesView();
        if (state.activeView === "commands") renderCommandsView();
      }
      renderConversationOutline();
      addSystemMessage(payload.mode === "resume" ? "Thread resumed and settings synchronized." : payload.mode === "fork" ? "Thread forked." : "New Codex thread created.");
      refreshThreadList();
      updateControls();
      messageInput.focus();
      break;

    case "settingsUpdateAccepted":
      mergeThreadSettings(payload.requested);
      addSystemMessage(payload.mode === "thread" ? "Model/settings update accepted by App Server." : `Settings will apply on the next turn. App Server update fallback: ${payload.warning}`, payload.mode === "thread" ? "info" : "warning");
      break;

    case "turnAccepted":
      state.activeTurnId = payload.turn.id;
      state.running = true;
      state.threadStatus = "active";
      setTurnActivityWorking(payload.turn.startedAt);
      updateControls();
      break;

    case "compactAccepted":
      addSystemMessage("Context compaction requested.");
      break;

    case "guardianDeniedActionApproved":
      state.latestGuardianDenial = null;
      addSystemMessage("Auto-review denial approved for one retry.");
      break;

    case "experimentalUpdated":
      if (Array.isArray(payload.experiments)) state.experiments = payload.experiments;
      else {
        const feature = state.experiments.find((item) => (item.name || item.id) === payload.name);
        if (feature) feature.enabled = payload.enabled;
      }
      addSystemMessage(`Experimental feature ${payload.name}: ${payload.enabled ? "on" : "off"}.`);
      break;

    case "threadRenamed":
      state.threadMeta.name = payload.name;
      addSystemMessage(`Thread renamed to: ${payload.name}`);
      refreshThreadList();
      updateControls();
      break;

    case "threadArchived":
    case "threadDeleted": {
      const verb = payload.type === "threadArchived" ? "archived" : "deleted";
      state.threadId = null;
      state.activeTurnId = null;
      state.running = false;
      state.threadStatus = "notLoaded";
      state.threadMeta = {};
      clearTurnActivity();
      state.tokenUsage = null;
      state.tokenUsageThreadId = null;
      state.latestGuardianDenial = null;
      localStorage.removeItem("codexMathThreadId");
      threadIdInput.value = "";
      addSystemMessage(`Thread ${verb}.`);
      refreshThreadList();
      updateControls();
      break;
    }

    case "threadList":
      applyThreadList(payload.result, payload.append, payload.error);
      break;

    case "reviewAccepted":
      state.activeTurnId = payload.turn?.id || null;
      state.running = true;
      state.threadStatus = "active";
      setTurnActivityWorking(payload.turn?.startedAt);
      addSystemMessage("Code review started.");
      updateControls();
      break;

    case "goalResult":
      if (payload.action === "get") openTextDialog("Thread goal", JSON.stringify(payload.result, null, 2));
      else addSystemMessage(payload.action === "clear" ? "Thread goal cleared." : "Thread goal updated.");
      break;

    case "memoryModeUpdated":
      state.threadMeta.memoryMode = payload.mode;
      addSystemMessage(`Memory mode: ${payload.mode}`);
      updateControls();
      break;

    case "backgroundTerminalsResult":
      openTextDialog("Background terminals", JSON.stringify(payload.result, null, 2));
      break;

    case "backgroundTerminalsCleaned":
      addSystemMessage("All background terminals were stopped.");
      break;

    case "loggedOut":
      state.account = null;
      addSystemMessage("Logged out of Codex.", "warning");
      updateControls();
      break;

    case "mcpResult":
      state.mcpInventory = normalizeMcpInventory(payload.result, state.config, state.mcpStartupStatuses);
      renderMcpInspector();
      if (state.mcpDialogRequested) {
        openTextDialog(
          payload.reloaded ? "MCP servers (config reloaded)" : payload.verbose ? "MCP servers (verbose)" : "MCP servers",
          formatMcpInventory(payload.result, state.config, state.mcpStartupStatuses, payload.verbose),
        );
      }
      state.mcpDialogRequested = false;
      break;

    case "fileSearchResult":
      if (payload.query === state.mentionQuery) {
        state.fileMatches = Array.isArray(payload.result?.files) ? payload.result.files.filter((file) => file.match_type === "file") : [];
        state.mentionIndex = 0;
        renderMentionPalette();
      }
      break;

    case "skillsResult":
      showSkillChoices(payload.result);
      break;

    case "hooksResult":
      openTextDialog("Hooks", formatHooksResult(payload.result));
      break;

    case "appsResult":
      openTextDialog("Apps", formatAppsResult(payload.result));
      break;

    case "pluginsResult":
      openTextDialog("Plugins", formatPluginsResult(payload.result));
      break;

    case "usageResult":
      openTextDialog("Usage and rate limits", JSON.stringify(payload.result, null, 2));
      break;

    case "codex":
      handleCodex(payload.message);
      break;

    case "bridgeError":
      state.running = false;
      clearTurnActivity();
      addSystemMessage(payload.message, "error");
      updateControls();
      break;

    default:
      break;
  }
});

function switchView(view) {
  if (!["conversation", "changes", "commands"].includes(view)) return;
  state.activeView = view;
  for (const panel of document.querySelectorAll("[data-view-panel]")) panel.classList.toggle("active", panel.dataset.viewPanel === view);
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  if (view === "changes") renderChangesView();
  if (view === "commands") renderCommandsView();
}

function syncSidebarToggle() {
  const isMobile = window.innerWidth < 960;
  const open = isMobile ? sidebar.classList.contains("open") : !sidebar.classList.contains("collapsed");
  const label = isMobile
    ? (open ? "Close conversations" : "Open conversations")
    : (open ? "Collapse conversations" : "Expand conversations");
  sidebarToggleButton.setAttribute("aria-label", label);
  sidebarToggleButton.setAttribute("title", label);
  sidebarToggleButton.setAttribute("aria-expanded", String(open));
}

function syncSidebarViewport() {
  if (window.innerWidth < 960) {
    sidebar.classList.remove("collapsed");
    inspector.classList.add("closed");
  } else {
    sidebar.classList.remove("open");
    const saved = localStorage.getItem("codexSidebarOpen");
    sidebar.classList.toggle("collapsed", saved === "false");
  }
  syncSidebarToggle();
  updateBackdrop();
}

function setSidebarOpen(open) {
  if (window.innerWidth < 960) {
    sidebar.classList.toggle("open", open);
  } else {
    sidebar.classList.toggle("collapsed", !open);
    localStorage.setItem("codexSidebarOpen", String(open));
  }
  syncSidebarToggle();
  updateBackdrop();
}

function toggleSidebar() {
  const open = window.innerWidth < 960
    ? sidebar.classList.contains("open")
    : !sidebar.classList.contains("collapsed");
  setSidebarOpen(!open);
}

function updateBackdrop() {
  const sidebarOpen = sidebar.classList.contains("open");
  const inspectorOverlayOpen = window.innerWidth < 1360 && !inspector.classList.contains("closed");
  drawerBackdrop.classList.toggle("hidden", !sidebarOpen && !inspectorOverlayOpen);
}

function toggleInspector(force) {
  const open = force ?? inspector.classList.contains("closed");
  inspector.classList.toggle("closed", !open);
  localStorage.setItem("codexInspectorOpen", String(open));
  updateBackdrop();
  if (open) {
    state.mcpDialogRequested = false;
    send({ type: "listMcp", verbose: false });
  }
}

function closeDrawers() {
  sidebar.classList.remove("open");
  if (window.innerWidth < 1360) inspector.classList.add("closed");
  syncSidebarToggle();
  updateBackdrop();
}

function navigateHistory(delta) {
  const next = navigateThread(state.navigation, delta);
  if (!next.threadId || next.threadId === state.threadId) return;
  state.navigation = { items: next.items, index: next.index };
  state.navigatingHistory = true;
  resumeThread(next.threadId);
  updateControls();
}

modelSelect.addEventListener("change", () => {
  populateEfforts();
  populateTiers();
  updateThreadSettings();
});
effortSelect.addEventListener("change", updateThreadSettings);
tierSelect.addEventListener("change", updateThreadSettings);
permissionSelect.addEventListener("change", updateThreadSettings);
inspectorModelSelect.addEventListener("change", () => {
  modelSelect.value = inspectorModelSelect.value;
  populateEfforts();
  populateTiers();
  updateThreadSettings();
});
inspectorEffortSelect.addEventListener("change", () => {
  effortSelect.value = inspectorEffortSelect.value;
  updateThreadSettings();
});
newThreadButton.addEventListener("click", () => startNewThread());
refreshThreadsButton.addEventListener("click", () => refreshThreadList());
loadMoreThreadsButton.addEventListener("click", () => refreshThreadList(state.threadListCursor));
threadSearchInput.addEventListener("input", () => {
  renderThreadList();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => refreshThreadList(null, threadSearchInput.value.trim()), 280);
});
resumeButton.addEventListener("click", () => resumeThread());
threadIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resumeThread();
});
statusButton.addEventListener("click", showStatus);
connectionStatus.addEventListener("click", () => send({ type: "refreshMetadata", cwd: cwdInput.value.trim() }));
sendButton.addEventListener("click", submitMessage);
function interruptActiveTurn() {
  if (!state.running || !state.activeTurnId) return;
  send({ type: "interrupt", turnId: state.activeTurnId });
}
stopButton.addEventListener("click", interruptActiveTurn);

messageInput.addEventListener("input", () => {
  if (state.choicePalette) state.choicePalette = null;
  state.paletteIndex = 0;
  autoSizeComposer();
  if (mentionToken()) requestMentionSearch();
  else updateSlashPalette();
});

messageInput.addEventListener("compositionstart", () => { state.composing = true; });
messageInput.addEventListener("compositionend", () => { state.composing = false; });

messageInput.addEventListener("keydown", (event) => {
  if (state.composing || event.isComposing || event.keyCode === 229) return;
  if (!mentionPalette.classList.contains("hidden") && state.fileMatches.length) {
    const count = Math.min(12, state.fileMatches.length);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      state.mentionIndex = (state.mentionIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      renderMentionPalette();
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      chooseMention(state.fileMatches[state.mentionIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      mentionPalette.classList.add("hidden");
      return;
    }
  }
  if (state.choicePalette && !slashPalette.classList.contains("hidden")) {
    const count = state.choicePalette.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.paletteIndex = (state.paletteIndex + delta + count) % count;
      renderChoicePalette();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      choosePaletteItem();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      state.choicePalette = null;
      slashPalette.classList.add("hidden");
      return;
    }
  }
  const matches = paletteMatches();
  if (!slashPalette.classList.contains("hidden") && matches.length) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.paletteIndex = (state.paletteIndex + 1) % matches.length;
      updateSlashPalette();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.paletteIndex = (state.paletteIndex - 1 + matches.length) % matches.length;
      updateSlashPalette();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      commitPaletteSelection(matches[state.paletteIndex], "tab");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitPaletteSelection(matches[state.paletteIndex], "enter");
      return;
    }
    if (event.key === "Escape") {
      slashPalette.classList.add("hidden");
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitMessage();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".composer-shell")) {
    state.choicePalette = null;
    slashPalette.classList.add("hidden");
    mentionPalette.classList.add("hidden");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.running && state.activeTurnId) {
    event.preventDefault();
    interruptActiveTurn();
  }
});

for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => switchView(button.dataset.view));
outlineTab.addEventListener("click", () => setInspectorTab("outline"));
sessionTab.addEventListener("click", () => setInspectorTab("session"));
outlineBottomButton.addEventListener("click", () => {
  scrollToBottom(true);
  const messages = [...state.messageNodes.values()].filter((record) => record.role === "user");
  setActiveOutlineMessage(messages.at(-1)?.id || null);
});
$("#railSearchButton").addEventListener("click", () => {
  setSidebarOpen(true);
  threadSearchInput.focus();
});
$("#railMcpButton").addEventListener("click", () => {
  toggleInspector(true);
});
$("#railSettingsButton").addEventListener("click", () => toggleInspector());
$("#inspectorButton").addEventListener("click", () => toggleInspector());
$("#mobileMoreButton").addEventListener("click", () => toggleInspector(true));
$("#closeInspectorButton").addEventListener("click", () => toggleInspector(false));
sidebarToggleButton.addEventListener("click", toggleSidebar);
window.addEventListener("resize", syncSidebarViewport);
drawerBackdrop.addEventListener("click", closeDrawers);
$("#backThreadButton").addEventListener("click", () => navigateHistory(-1));
$("#forwardThreadButton").addEventListener("click", () => navigateHistory(1));
$("#refreshMcpButton").addEventListener("click", () => { state.mcpDialogRequested = false; send({ type: "listMcp", verbose: false }); });
function openMentionInput() {
  const separator = messageInput.value && !/\s$/.test(messageInput.value) ? " " : "";
  messageInput.setRangeText(`${separator}@`, messageInput.selectionStart, messageInput.selectionEnd, "end");
  messageInput.dispatchEvent(new Event("input"));
  messageInput.focus();
}
$("#mentionButton").addEventListener("click", openMentionInput);
imageInput.addEventListener("change", async () => {
  try {
    const files = [...imageInput.files];
    if (state.images.length + files.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images`);
    state.images.push(...await Promise.all(files.map(readImage)));
    renderAttachmentChips();
  } catch (error) {
    addSystemMessage(error.message, "error");
  } finally {
    imageInput.value = "";
  }
});
chat.addEventListener("scroll", () => {
  state.followOutput = shouldFollowScroll(chat);
  jumpToBottomButton.classList.toggle("hidden", state.followOutput);
  if (state.threadId) scheduleThreadUiSave();
}, { passive: true });
jumpToBottomButton.addEventListener("click", () => scrollToBottom(true));
chat.addEventListener("toggle", () => requestAnimationFrame(() => scrollToBottom()), true);
new MutationObserver(() => requestAnimationFrame(() => scrollToBottom())).observe(chat, { childList: true });

$("#workspaceButton").addEventListener("click", () => {
  cwdDialogInput.value = currentCwd();
  cwdDialog.showModal();
  cwdDialogInput.focus();
});
$("#applyCwdButton").addEventListener("click", (event) => {
  event.preventDefault();
  const cwd = cwdDialogInput.value.trim();
  if (!cwd) return;
  cwdInput.value = cwd;
  localStorage.setItem("codexMathCwd", cwd);
  if (state.threadId) send({ type: "updateSettings", cwd });
  else send({ type: "refreshMetadata", cwd });
  cwdDialog.close();
  updateControls();
});
cwdInput.addEventListener("change", () => {
  const cwd = cwdInput.value.trim();
  if (!cwd) return;
  localStorage.setItem("codexMathCwd", cwd);
  if (state.threadId) send({ type: "updateSettings", cwd });
  updateControls();
});

async function copyField(value) {
  try { await navigator.clipboard.writeText(value); }
  catch (error) { addSystemMessage(`Clipboard error: ${error.message}`, "error"); }
}
$("#copyThreadIdButton").addEventListener("click", () => copyField(state.threadId || ""));
$("#copyCwdButton").addEventListener("click", () => copyField(currentCwd()));
$("#accountButton").addEventListener("click", showStatus);
window.addEventListener("resize", () => {
  updateBackdrop();
  renderContextSummary(contextStats());
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  state.choicePalette = null;
  slashPalette.classList.add("hidden");
  mentionPalette.classList.add("hidden");
  if (window.innerWidth < 1360) closeDrawers();
});

autoSizeComposer();
renderChangesView();
renderCommandsView();
updateControls();
