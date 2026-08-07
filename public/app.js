import DOMPurify from "/vendor/dompurify/dist/purify.es.mjs";
import katex from "/vendor/katex/dist/katex.mjs";
import { marked } from "/vendor/marked/lib/marked.esm.js";
import { extractMath, findStableMarkdownBoundary, renderMathSlots } from "/math-renderer.js";
import { guardianEventFromNotification, prioritizeSlashMatches, resolveSlashSelection } from "/slash-input.js";
import { slashAliases, slashCommands } from "/slash-commands.js";
import { currentApproval, enqueueApproval, removeApproval as removeQueuedApproval } from "/approval-data.js";
import { codexVersion, formatCompactNumber, providerStatus, threadTokenStats, unwrapConfig } from "/status-data.js";
import { formatMcpInventory, normalizeMcpInventory } from "/mcp-data.js";
import { compactThreadCwd, filterThreads, formatThreadTime, groupThreads, mergeThreadPages, threadTitle } from "/thread-list-data.js";
import { removeThreadById, removeThreadFromNavigation } from "/thread-delete-data.js";
import { composeUserInput, displayInput, makeMention, MAX_IMAGES, validateImage } from "/composer-input.js";
import { diffRowMarker, normalizeFileChanges, visibleDiffRows } from "/diff-data.js";
import { normalizeFileSearchFiles } from "/file-search-data.js";
import { countOutputLines, normalizeToolStatus, presentCommand, searchActivityLabel, tailOutputLines, toolInputPreview } from "/command-presentation.js";
import { buildConversationBlocks, buildProcessDetailsForTurns, commandGroupId, isGroupableReadonlyCommand, mergeCachedTools } from "/conversation-blocks.js";
import { buildProcessDetails, normalizeDisplayStatus, presentTool } from "/message-display.js";
import { createQueueEntry, isQueueEntryRetryable, nextQueueEntry, queueForThread, queueReducer } from "/queue-data.js";
import { normalizeThread } from "/thread-items.js";
import { isNotificationForThread } from "/notification-scope.js";
import {
  canImplementPlan,
  normalizePlanSnapshot,
  PLAN_IMPLEMENTATION_PROMPT,
  planSnapshotKey,
} from "/plan-data.js";
import {
  buildUserInputResult,
  countUserInputAnswers,
  isUserInputAnswerComplete,
  normalizeUserInputQuestions,
  resetUserInputRequest,
  USER_INPUT_OTHER,
} from "/user-input-data.js";
import { createSessionSettings, navigateThread, pushThreadNavigation, resolveReasoningEffort, shouldFollowScroll } from "/session-state.js";
import { formatActivityDuration, isActiveTurnStatus, resolveTurnDurationMs, timestampToMs } from "/turn-activity.js";
import { renderIcons } from "/icons.js";

marked.setOptions({ gfm: true, breaks: false });

const $ = (selector) => document.querySelector(selector);
const connectionStatus = $("#connectionStatus");
const cwdInput = $("#cwdInput");
const workspaceButton = $("#workspaceButton");
const modelSelect = $("#modelSelect");
const effortSelect = $("#effortSelect");
const collaborationModeSelect = $("#collaborationModeSelect");
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
const chatEmptyState = $("#chatEmptyState");
const approvalArea = $("#approvalArea");
const composer = $(".composer");
const turnActivity = $("#turnActivity");
const queueShelf = $("#queueShelf");
const messageInput = $("#messageInput");
const slashPalette = $("#slashPalette");
const sendButton = $("#sendButton");
const stopButton = $("#stopButton");
const steerButton = $("#steerButton");
const followUpButton = $("#followUpButton");
const mentionButton = $("#mentionButton");
const attachButton = $(".attach-button");
const threadLabel = $("#threadLabel");
const statusDialog = $("#statusDialog");
const statusSubtitle = $("#statusSubtitle");
const statusGrid = $("#statusGrid");
const rawStatus = $("#rawStatus");
const textDialog = $("#textDialog");
const textDialogTitle = $("#textDialogTitle");
const textDialogBody = $("#textDialogBody");
const deleteThreadDialog = $("#deleteThreadDialog");
const deleteThreadDialogTitle = $("#deleteThreadDialogTitle");
const deleteThreadDialogCwd = $("#deleteThreadDialogCwd");
const confirmDeleteThreadButton = $("#confirmDeleteThreadButton");
const inspector = $("#inspector");
const inspectorModelSelect = $("#inspectorModelSelect");
const inspectorEffortSelect = $("#inspectorEffortSelect");
const inspectorCollaborationModeSelect = $("#inspectorCollaborationModeSelect");
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
const mathRenderCache = new Map();

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
  processNodes: new Map(),
  planSnapshots: new Map(),
  planNodes: new Map(),
  planDeltaBuffers: new Map(),
  latestPlanKey: null,
  renderTimers: new Map(),
  toolOutputTimers: new Map(),
  viewRenderTimers: new Map(),
  pendingScrollFrame: null,
  threadUiSaveTimer: null,
  lastSavedThreadUi: null,
  commandDurationTimer: null,
  approvals: [],
  latestGuardianDenial: null,
  mcpStartupStatuses: {},
  paletteIndex: 0,
  choicePalette: null,
  threads: [],
  threadListCursor: null,
  threadListError: null,
  threadListLoading: true,
  deletingThreadIds: new Set(),
  pendingThreadDeletes: new Map(),
  deleteDialogThread: null,
  deleteDialogThreadId: null,
  userInputRequest: null,
  sessionSettings: createSessionSettings(),
  activeView: "conversation",
  threadView: normalizeThread({}),
  commandItems: new Map(),
  changeItems: new Map(),
  searchNodes: new Map(),
  commandObservedStartMs: new Map(),
  conversationOrder: [],
  toolCacheItems: new Map(),
  toolCacheSequence: 0,
  toolCacheSaveTimer: null,
  lastSavedToolCache: null,
  turnDiff: "",
  currentTurn: null,
  activityMode: "idle",
  activityStartedAtMs: null,
  activityDurationMs: null,
  activityStatus: null,
  activityLabel: null,
  activityTimer: null,
  searchActivities: new Map(),
  mentions: [],
  images: [],
  fileMatches: [],
  fileSearchSessionId: null,
  fileSearchSearching: false,
  fileSearchError: null,
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
  expandedCommands: new Set(),
  collapsedCommands: new Set(),
  expandedCommandGroups: new Set(),
  expandedMcpTools: new Set(),
  expandedCommandOutputs: new Set(),
  expandedProcesses: new Set(),
  queueEntries: [],
  queueRequestIds: new Map(),
  queueDispatch: null,
  ignoredQueueRequestIds: new Set(),
  steerRequestInputs: new Map(),
  historicalProcessAnswerIds: new Set(),
  outlineObserver: null,
  outlineNodes: new Map(),
  activeOutlineNode: null,
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
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    addSystemMessage("WebSocket is not connected.", "error");
    return false;
  }
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
  const signature = `${source.disabled}|${value}|${[...source.options].map((option) => `${option.value}:${option.textContent}:${option.disabled}`).join("\u001f")}`;
  if (target.dataset.optionsSignature === signature) {
    target.disabled = source.disabled;
    return;
  }
  target.replaceChildren(...[...source.options].map((option) => option.cloneNode(true)));
  target.value = value;
  target.disabled = source.disabled;
  target.dataset.optionsSignature = signature;
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
  const collaborationMode = collaborationModePayload(collaborationModeSelect.value);
  return {
    model: modelSelect.value || null,
    effort: effortSelect.value || null,
    serviceTier: tierSelect.value || null,
    permissions: permissionSelect.value || null,
    ...(collaborationMode ? { collaborationMode } : {}),
  };
}

function collaborationModeValue(source = state.threadMeta.collaborationMode) {
  if (source && typeof source === "object") return source.mode || source.name || "";
  return String(source || "").trim();
}

function collaborationModeStorageKey(threadId) {
  return `codexCollaborationMode:${String(threadId || "")}`;
}

function rememberCollaborationMode(threadId, value) {
  const mode = collaborationModeValue(value);
  if (threadId && mode) localStorage.setItem(collaborationModeStorageKey(threadId), mode);
}

function collaborationModePreset(value) {
  const target = String(value || "").trim();
  return state.collaborationModes.find((preset) =>
    String(preset?.mode || "") === target || String(preset?.name || "") === target,
  ) || null;
}

function collaborationModePayload(value = collaborationModeSelect.value) {
  const mode = String(value || "").trim();
  if (!mode) return null;
  const preset = collaborationModePreset(mode);
  const presetMode = preset?.mode || mode;
  const presetModel = preset?.model || currentModelLabel();
  const presetEffort = preset?.reasoning_effort ?? displayEffortLabel();
  return {
    mode: presetMode,
    settings: {
      model: String(presetModel || modelSelect.value || ""),
      reasoning_effort: presetEffort && presetEffort !== "default" ? String(presetEffort) : null,
      developer_instructions: null,
    },
  };
}

function collaborationModeLabel(preset) {
  const mode = preset?.mode || preset?.name || "default";
  if (mode === "plan") return "Plan";
  if (mode === "default") return "Default";
  return String(preset?.name || mode);
}

function populateCollaborationModes(preferred) {
  const current = collaborationModeValue(state.threadMeta.collaborationMode);
  const previous = preferred !== undefined
    ? String(preferred || "")
    : (collaborationModeSelect.value || current || localStorage.getItem("codexCollaborationMode") || "");
  collaborationModeSelect.replaceChildren();

  const presets = [...state.collaborationModes];
  if (current && !presets.some((preset) => (preset?.mode || preset?.name) === current)) {
    presets.push({ mode: current, name: current });
  }
  for (const preset of presets) {
    const value = String(preset?.mode || preset?.name || "").trim();
    if (!value || [...collaborationModeSelect.options].some((option) => option.value === value)) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = collaborationModeLabel(preset);
    if (preset?.name && preset.name !== value) option.title = preset.name;
    collaborationModeSelect.append(option);
  }
  if (previous && ![...collaborationModeSelect.options].some((option) => option.value === previous)) {
    const option = document.createElement("option");
    option.value = previous;
    option.textContent = previous === "plan" ? "Plan" : previous === "default" ? "Default" : previous;
    collaborationModeSelect.append(option);
  }
  if (!collaborationModeSelect.options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Mode unavailable";
    collaborationModeSelect.append(option);
  }
  const defaultMode = [...collaborationModeSelect.options].find((option) => option.value === "default")?.value;
  collaborationModeSelect.value = previous && [...collaborationModeSelect.options].some((option) => option.value === previous)
    ? previous
    : defaultMode || collaborationModeSelect.options[0].value;
  copySelectOptions(collaborationModeSelect, inspectorCollaborationModeSelect);
  inspectorCollaborationModeSelect.value = collaborationModeSelect.value;
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
  populateCollaborationModes();
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
  localStorage.setItem("codexCollaborationMode", collaborationModeSelect.value || "");
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

function renderContextUsage(context = contextStats()) {
  renderContextSummary(context);
  const usedPercent = context.usedPercent ?? 0;
  contextMeterFill.style.width = `${Math.min(100, Math.max(0, usedPercent))}%`;
  contextDetail.textContent = context.windowSize
    ? `${formatNumber(context.contextUsed)} used · ${formatNumber(Math.max(0, context.windowSize - context.contextUsed))} remaining · ${formatNumber(context.windowSize)} limit`
    : "Usage unavailable";
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

function currentCollaborationModeLabel() {
  return collaborationModeValue(state.threadMeta.collaborationMode)
    || collaborationModeSelect.value
    || "default";
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
  const searching = mode === "working" && String(state.activityLabel || "").startsWith("Searching");
  let labelText = "";
  let detailText = "";
  let ariaLabel = "";
  if (mode === "working") {
    const startedAtMs = Number.isFinite(state.activityStartedAtMs) ? state.activityStartedAtMs : Date.now();
    const elapsed = Math.max(0, Date.now() - startedAtMs);
    const duration = formatActivityDuration(elapsed);
    labelText = state.activityLabel || "Working";
    detailText = `(${duration} • Esc to interrupt)`;
    ariaLabel = `${labelText} for ${duration}`;
  } else if (mode !== "idle") {
    const duration = formatActivityDuration(state.activityDurationMs);
    labelText = duration ? `Worked for ${duration}` : "Worked";
    if (state.activityStatus && !["completed", "complete", "idle"].includes(String(state.activityStatus).toLowerCase())) {
      detailText = `(${state.activityStatus})`;
    }
    ariaLabel = labelText;
  }
  const renderKey = `${mode}|${labelText}|${detailText}|${ariaLabel}`;
  if (turnActivity.dataset.renderKey === renderKey) return;
  turnActivity.dataset.renderKey = renderKey;
  turnActivity.className = `turn-activity${mode === "idle" ? " hidden" : ` ${mode}`}${searching ? " searching" : ""}`;
  if (mode === "idle") {
    turnActivity.removeAttribute("aria-label");
    return;
  }
  let symbol = turnActivity.querySelector(".activity-symbol");
  let label = turnActivity.querySelector(".activity-label");
  let detail = turnActivity.querySelector(".activity-detail");
  if (!symbol || !label || !detail) {
    turnActivity.replaceChildren();
    symbol = document.createElement("span");
    symbol.className = "activity-symbol";
    symbol.setAttribute("aria-hidden", "true");
    label = document.createElement("strong");
    label.className = "activity-label";
    detail = document.createElement("span");
    detail.className = "activity-detail";
    turnActivity.append(symbol, label, detail);
  }
  symbol.textContent = mode === "working" ? "●" : "─";
  label.textContent = labelText;
  detail.textContent = detailText;
  turnActivity.setAttribute("aria-label", ariaLabel);
}

function activeSearchActivityLabel() {
  return [...state.searchActivities.values()].at(-1) || null;
}

function setTurnActivityWorking(startedAt = null, label = null) {
  const wasWorking = state.activityMode === "working";
  const explicitStart = timestampToMs(startedAt);
  const fallbackStart = wasWorking && Number.isFinite(state.activityStartedAtMs)
    ? state.activityStartedAtMs
    : Date.now();
  state.activityMode = "working";
  state.activityStartedAtMs = explicitStart ?? fallbackStart;
  state.activityDurationMs = null;
  state.activityStatus = "inProgress";
  state.activityLabel = label || activeSearchActivityLabel() || "Working";
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
  state.searchActivities.clear();
  state.activityMode = "worked";
  state.activityDurationMs = resolveTurnDurationMs(turn, fallbackStartedAtMs);
  state.activityStartedAtMs = timestampToMs(turn?.startedAt) ?? fallbackStartedAtMs;
  state.activityStatus = turn?.status || "completed";
  state.activityLabel = null;
  renderTurnActivity();
}

function clearTurnActivity() {
  stopActivityTimer();
  state.activityMode = "idle";
  state.activityStartedAtMs = null;
  state.activityDurationMs = null;
  state.activityStatus = null;
  state.activityLabel = null;
  state.searchActivities.clear();
  renderTurnActivity();
}

function startSearchActivity(item) {
  const label = searchActivityLabel(item);
  if (!label || !item?.id) return;
  state.searchActivities.set(item.id, label);
  setTurnActivityWorking(null, label);
}

function completeSearchActivity(item) {
  if (!item?.id) return;
  state.searchActivities.delete(item.id);
  if (state.running) setTurnActivityWorking(null, activeSearchActivityLabel() || "Working");
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

function currentQueueEntries() {
  return queueForThread(state.queueEntries, state.threadId);
}

function queueStatusLabel(status) {
  return {
    pending: "Queued",
    sending: "Sending",
    accepted: "Accepted",
    failed: "Failed",
  }[status] || status || "Queued";
}

function updateQueue(action) {
  state.queueEntries = queueReducer(state.queueEntries, action);
  renderQueueShelf();
}

function queueRequestId() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `queue-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderQueueShelf() {
  if (!queueShelf) return;
  const entries = currentQueueEntries();
  queueShelf.replaceChildren();
  queueShelf.classList.toggle("hidden", !entries.length);
  if (!entries.length) return;
  const heading = document.createElement("div");
  heading.className = "queue-shelf-heading";
  heading.textContent = `Queued messages · ${entries.length}`;
  queueShelf.append(heading);
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `queue-row queue-${entry.status}`;
    const mode = document.createElement("span");
    mode.className = "queue-mode";
    mode.textContent = entry.mode === "steer" ? "Steer" : "Follow up";
    const text = document.createElement("span");
    text.className = "queue-text";
    text.textContent = entry.displayText;
    text.title = entry.displayText;
    const status = document.createElement("span");
    status.className = "queue-status";
    status.textContent = entry.error ? `${queueStatusLabel(entry.status)}: ${entry.error}` : queueStatusLabel(entry.status);
    status.title = entry.error || queueStatusLabel(entry.status);
    row.append(mode, text, status);
    if (isQueueEntryRetryable(entry)) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "queue-row-action";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => {
        updateQueue({ type: "retry", id: entry.id });
        drainQueue();
      });
      row.append(retry);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-row-action";
    remove.textContent = "Remove";
    remove.disabled = entry.status === "sending";
    if (remove.disabled) remove.title = "Wait for the current queue request to finish.";
    remove.addEventListener("click", () => {
      if (entry.status === "sending") return;
      updateQueue({ type: "remove", id: entry.id });
      if (!state.running && !queueDispatchActive()) drainQueue();
    });
    row.append(remove);
    queueShelf.append(row);
  }
}

function failQueueEntry(entryId, error) {
  if (!entryId) return;
  updateQueue({ type: "failed", id: entryId, error: error?.message || error || "Queue request failed" });
}

function queueDispatchActive(threadId = state.threadId) {
  const dispatch = state.queueDispatch;
  return Boolean(dispatch?.requestId && (!threadId || dispatch.threadId === threadId));
}

function releaseQueueDispatch({ fail = false, error = "Queue request interrupted." } = {}) {
  const requests = new Map(state.queueRequestIds);
  if (state.queueDispatch?.requestId) requests.set(state.queueDispatch.requestId, state.queueDispatch.entryId);
  for (const [requestId, entryId] of requests) {
    state.ignoredQueueRequestIds.add(requestId);
    if (fail) failQueueEntry(entryId, error);
  }
  while (state.ignoredQueueRequestIds.size > 128) {
    state.ignoredQueueRequestIds.delete(state.ignoredQueueRequestIds.values().next().value);
  }
  state.queueDispatch = null;
  state.queueRequestIds.clear();
}

function clearQueuedMessages() {
  releaseQueueDispatch();
  state.queueEntries = [];
  state.steerRequestInputs.clear();
  renderQueueShelf();
}

function consumeIgnoredQueueResponse(requestId) {
  if (!requestId || !state.ignoredQueueRequestIds.has(requestId)) return false;
  state.ignoredQueueRequestIds.delete(requestId);
  return true;
}

function drainQueue() {
  if (state.running || state.queueDispatch || !state.threadId) return false;
  const entry = nextQueueEntry(state.queueEntries, state.threadId);
  if (!entry) return false;
  const requestId = queueRequestId();
  state.queueDispatch = { threadId: state.threadId, entryId: entry.id, requestId };
  state.queueRequestIds.set(requestId, entry.id);
  updateQueue({ type: "sending", id: entry.id, requestId });
  const sent = send({
    type: "sendMessage",
    requestId,
    threadId: state.threadId,
    clientUserMessageId: entry.id,
    input: entry.input,
    ...(selectedSettings() || {}),
  });
  if (!sent) {
    state.queueDispatch = null;
    state.queueRequestIds.delete(requestId);
    failQueueEntry(entry.id, "WebSocket is not connected.");
    return false;
  }
  return true;
}

function enqueueFollowUp(input) {
  if (!state.threadId) {
    addSystemMessage("Start or resume a thread first.", "error");
    return false;
  }
  const entry = createQueueEntry({
    threadId: state.threadId,
    input,
    displayText: displayInput(input),
    mode: "followUp",
  });
  updateQueue({ type: "enqueue", entry });
  if (!state.running && !queueDispatchActive()) drainQueue();
  return true;
}

function steerCurrentTurn(input) {
  if (!state.threadId || !state.activeTurnId) {
    addSystemMessage("There is no steerable active turn.", "warning");
    return false;
  }
  const requestId = queueRequestId();
  state.steerRequestInputs.set(requestId, input);
  const sent = send({
    type: "steerMessage",
    requestId,
    threadId: state.threadId,
    expectedTurnId: state.activeTurnId,
    clientUserMessageId: requestId,
    input,
  });
  if (!sent) state.steerRequestInputs.delete(requestId);
  return sent;
}

function clearComposerInput() {
  messageInput.value = "";
  state.mentions = [];
  state.images = [];
  renderAttachmentChips();
  autoSizeComposer();
  slashPalette.classList.add("hidden");
  mentionPalette.classList.add("hidden");
}

function updateControls() {
  const hasThread = Boolean(state.threadId);
  const canStart = state.ready && !state.running;
  const canConfigure = canStart;
  modelSelect.disabled = !canConfigure;
  effortSelect.disabled = !canConfigure || !modelSelect.value;
  collaborationModeSelect.disabled = !canConfigure || !collaborationModeSelect.options.length || collaborationModeSelect.options[0].value === "";
  tierSelect.disabled = !canConfigure || !modelSelect.value;
  permissionSelect.disabled = !canConfigure;
  inspectorModelSelect.disabled = !canConfigure;
  inspectorEffortSelect.disabled = !canConfigure || !modelSelect.value;
  inspectorCollaborationModeSelect.disabled = !canConfigure || !collaborationModeSelect.options.length || collaborationModeSelect.options[0].value === "";
  newThreadButton.disabled = !canStart;
  refreshThreadsButton.disabled = !state.ready || state.threadListLoading;
  loadMoreThreadsButton.disabled = !state.ready || state.threadListLoading;
  resumeButton.disabled = !canStart;
  statusButton.disabled = !state.ready;
  const awaitingUserInput = Boolean(state.userInputRequest);
  messageInput.disabled = !hasThread || awaitingUserInput;
  sendButton.disabled = !hasThread || state.running || awaitingUserInput;
  stopButton.disabled = !state.running;
  stopButton.classList.toggle("hidden", !state.running);
  sendButton.classList.toggle("hidden", state.running);
  steerButton.disabled = !hasThread || !state.running || awaitingUserInput;
  followUpButton.disabled = !hasThread || !state.running || awaitingUserInput;
  steerButton.classList.toggle("hidden", !state.running);
  followUpButton.classList.toggle("hidden", !state.running);
  if (mentionButton) mentionButton.disabled = !hasThread || awaitingUserInput;
  if (imageInput) imageInput.disabled = !hasThread || awaitingUserInput;
  if (attachButton) attachButton.classList.toggle("disabled", !hasThread || awaitingUserInput);
  renderQueueShelf();

  const model = currentModelLabel();
  const effort = displayEffortLabel();
  const tier = currentTierLabel();
  const mode = currentCollaborationModeLabel();
  sessionSummary.textContent = hasThread
    ? `${model} ${effort}${tier !== "default" ? ` / ${tier}` : ""}${mode !== "default" ? ` / ${mode}` : ""}`
    : "No active thread";
  directorySummary.textContent = currentCwd();
  runStatus.textContent = state.threadStatus || (state.running ? "active" : hasThread ? "idle" : "notLoaded");
  runStatus.className = `pill status-${String(state.threadStatus || "unknown").replace(/[^a-zA-Z]/g, "").toLowerCase()}`;
  renderTurnActivity();

  const context = contextStats();
  renderContextUsage(context);
  syncPlanActionVisibility();

  threadLabel.textContent = hasThread ? `Thread: ${state.threadId}` : "No active thread";
  state.sessionSettings = createSessionSettings(state.threadMeta, {
    model: modelSelect.value,
    reasoningEffort: effortSelect.value,
    permissions: permissionSelect.value,
    serviceTier: tierSelect.value,
    collaborationMode: collaborationModePayload(collaborationModeSelect.value),
    cwd: cwdInput.value,
  });
  copySelectOptions(modelSelect, inspectorModelSelect);
  copySelectOptions(effortSelect, inspectorEffortSelect);
  copySelectOptions(collaborationModeSelect, inspectorCollaborationModeSelect);
  inspectorCollaborationModeSelect.value = collaborationModeSelect.value;
  workspaceName.textContent = shortPath(currentCwd());
  workspaceName.parentElement.title = currentCwd() || "Change working directory";
  directorySummary.title = currentCwd() || "Working directory unavailable";
  const branch = state.threadMeta.gitInfo?.branch;
  branchSummary.classList.toggle("hidden", !branch);
  branchSummary.querySelector("span").textContent = branch || "";
  inspectorThreadId.textContent = state.threadId || "No active thread";
  const provider = providerStatus(state.config, state.threadMeta.modelProvider);
  providerSummary.textContent = provider.name;
  const initials = accountLabel().split(/[@\s._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  $("#accountButton").textContent = initials;
  const navIndex = state.navigation.index;
  $("#backThreadButton").disabled = navIndex <= 0 || state.running;
  $("#forwardThreadButton").disabled = navIndex < 0 || navIndex >= state.navigation.items.length - 1 || state.running;
  syncThreadListControls();
}

function createThreadUiState() {
  return {
    diffInteractionVersion: 2,
    rightPanelTab: "outline",
    activeOutlineMessageId: null,
    expandedFileChanges: [],
    expandedDiffFiles: [],
    expandedCommands: [],
    collapsedCommands: [],
    expandedCommandGroups: [],
    expandedMcpTools: [],
    expandedCommandOutputs: [],
    expandedProcesses: [],
    scrollTop: 0,
  };
}

function threadUiStorageKey(threadId) {
  return `codexThreadUi:${threadId}`;
}

function threadToolStorageKey(threadId) {
  return `codexThreadTools:${threadId}`;
}

function readThreadToolCache(threadId) {
  if (!threadId) return [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(threadToolStorageKey(threadId)) || "null");
    const entries = Array.isArray(stored?.items) ? stored.items : [];
    return entries.filter((entry) => ["commandExecution", "fileChange", "mcpToolCall"].includes(entry?.item?.type) && entry.item.id);
  } catch {
    return [];
  }
}

function cacheToolItem(item, record, options = {}) {
  if (options.live === false || !state.threadId || !item?.id) return;
  const existing = state.toolCacheItems.get(item.id);
  const previous = record?.orderEntry?.previousItemId ?? existing?.previousItemId ?? null;
  const turnId = options.turnId ?? record?.orderEntry?.turnId ?? item.turnId ?? state.activeTurnId ?? null;
  state.toolCacheItems.set(item.id, {
    item: { ...item },
    turnId,
    previousItemId: previous,
    sequence: existing?.sequence ?? record?.orderEntry?.sequence ?? state.toolCacheSequence++,
  });
  scheduleToolCacheSave();
}

function saveToolCache() {
  if (!state.threadId) return;
  if (state.toolCacheSaveTimer !== null) {
    clearTimeout(state.toolCacheSaveTimer);
    state.toolCacheSaveTimer = null;
  }
  const entries = [...state.toolCacheItems.values()].sort((left, right) => left.sequence - right.sequence);
  if (!entries.length && sessionStorage.getItem(threadToolStorageKey(state.threadId))) return;
  let payload;
  try {
    payload = JSON.stringify({ version: 1, items: entries });
  } catch {
    payload = "";
  }
  if (!payload) return;
  if (state.lastSavedToolCache === payload) return;
  try {
    sessionStorage.setItem(threadToolStorageKey(state.threadId), payload);
    state.lastSavedToolCache = payload;
  } catch {
    // Keep the UI usable when a command emits more output than sessionStorage allows.
    const compact = entries.map((entry) => ({
      ...entry,
      item: entry.item?.aggregatedOutput
        ? { ...entry.item, aggregatedOutput: tailOutputLines(entry.item.aggregatedOutput, 200).join("\n") }
        : entry.item,
    }));
    try {
      const compactPayload = JSON.stringify({ version: 1, truncated: true, items: compact });
      sessionStorage.setItem(threadToolStorageKey(state.threadId), compactPayload);
      state.lastSavedToolCache = compactPayload;
    } catch {
      // Storage is optional; the live DOM and Commands view still retain the full item.
    }
  }
}

function scheduleToolCacheSave() {
  if (!state.threadId) return;
  if (state.toolCacheSaveTimer !== null) return;
  state.toolCacheSaveTimer = setTimeout(() => {
    state.toolCacheSaveTimer = null;
    saveToolCache();
  }, 180);
}

function readThreadUi(threadId) {
  const fallback = createThreadUiState();
  if (!threadId) return fallback;
  try {
    const stored = JSON.parse(sessionStorage.getItem(threadUiStorageKey(threadId)) || "null");
    return {
      ...fallback,
      ...(stored && typeof stored === "object" ? stored : {}),
      diffInteractionVersion: 2,
      expandedFileChanges: Array.isArray(stored?.expandedFileChanges) ? stored.expandedFileChanges : [],
      expandedDiffFiles: stored?.diffInteractionVersion === 2 && Array.isArray(stored?.expandedDiffFiles)
        ? stored.expandedDiffFiles
        : [],
      expandedCommands: Array.isArray(stored?.expandedCommands) ? stored.expandedCommands : [],
      collapsedCommands: Array.isArray(stored?.collapsedCommands) ? stored.collapsedCommands : [],
      expandedCommandGroups: Array.isArray(stored?.expandedCommandGroups) ? stored.expandedCommandGroups : [],
      expandedMcpTools: Array.isArray(stored?.expandedMcpTools) ? stored.expandedMcpTools : [],
      expandedCommandOutputs: Array.isArray(stored?.expandedCommandOutputs) ? stored.expandedCommandOutputs : [],
      expandedProcesses: Array.isArray(stored?.expandedProcesses) ? stored.expandedProcesses : [],
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
  const nextUi = {
    ...ui,
    activeOutlineMessageId: state.activeOutlineMessageId,
    expandedFileChanges: [...state.expandedFileChanges],
    expandedDiffFiles: [...state.expandedDiffFiles],
    expandedCommands: [...state.expandedCommands],
    collapsedCommands: [...state.collapsedCommands],
    expandedCommandGroups: [...state.expandedCommandGroups],
    expandedMcpTools: [...state.expandedMcpTools],
    expandedCommandOutputs: [...state.expandedCommandOutputs],
    expandedProcesses: [...state.expandedProcesses],
    scrollTop: chat.scrollTop,
  };
  const serialized = JSON.stringify(nextUi);
  state.threadUi = nextUi;
  if (state.lastSavedThreadUi === serialized) return;
  state.lastSavedThreadUi = serialized;
  sessionStorage.setItem(threadUiStorageKey(state.threadId), serialized);
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
  state.lastSavedThreadUi = null;
  state.expandedFileChanges = new Set(state.threadUi.expandedFileChanges);
  state.expandedDiffFiles = new Set(state.threadUi.expandedDiffFiles);
  state.expandedCommands = new Set(state.threadUi.expandedCommands);
  state.collapsedCommands = new Set(state.threadUi.collapsedCommands);
  state.expandedCommandGroups = new Set(state.threadUi.expandedCommandGroups);
  state.expandedMcpTools = new Set(state.threadUi.expandedMcpTools);
  state.expandedCommandOutputs = new Set(state.threadUi.expandedCommandOutputs);
  state.expandedProcesses = new Set(state.threadUi.expandedProcesses);
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
  const nextId = messageId || null;
  if (state.activeOutlineMessageId === nextId && state.activeOutlineNode?.isConnected) return;
  state.activeOutlineNode?.classList.remove("active");
  state.activeOutlineNode?.setAttribute("aria-current", "false");
  state.activeOutlineMessageId = nextId;
  state.activeOutlineNode = state.outlineNodes.get(nextId) || null;
  state.activeOutlineNode?.classList.add("active");
  state.activeOutlineNode?.setAttribute("aria-current", "true");
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
  state.outlineNodes.clear();
  state.activeOutlineNode = null;
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
    button.setAttribute("aria-current", "false");
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
    state.outlineNodes.set(record.id, button);
  });
  setActiveOutlineMessage(state.activeOutlineMessageId || messages[0].id, false);
  observeOutlineMessages();
}

function deleteRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDeleteThreadDialog(thread) {
  const threadId = String(thread?.id || "").trim();
  if (!threadId || state.deletingThreadIds.has(threadId)) return;
  if (threadId === state.threadId && state.running) {
    addSystemMessage("Stop the active turn before deleting this conversation.", "warning");
    return;
  }
  state.deleteDialogThread = { ...thread, id: threadId };
  state.deleteDialogThreadId = threadId;
  deleteThreadDialogTitle.textContent = threadTitle(thread);
  deleteThreadDialogCwd.textContent = thread.cwd || "Working directory unavailable";
  deleteThreadDialogCwd.title = thread.cwd || "Working directory unavailable";
  confirmDeleteThreadButton.disabled = false;
  deleteThreadDialog.showModal();
}

function requestDeleteThread(threadOrId) {
  const threadId = typeof threadOrId === "string"
    ? threadOrId.trim()
    : String(threadOrId?.id || "").trim();
  if (!threadId || state.deletingThreadIds.has(threadId)) return;
  if (threadId === state.threadId && state.running) {
    addSystemMessage("Stop the active turn before deleting this conversation.", "warning");
    return;
  }

  const requestId = deleteRequestId();
  state.deletingThreadIds.add(threadId);
  state.pendingThreadDeletes.set(requestId, threadId);
  renderThreadList();
  if (!send({ type: "deleteThread", threadId, requestId })) {
    state.pendingThreadDeletes.delete(requestId);
    state.deletingThreadIds.delete(threadId);
    renderThreadList();
  }
}

function removePendingThreadDelete(requestId, threadId = null) {
  const resolvedRequestId = String(requestId || "").trim();
  const resolvedThreadId = String(threadId || state.pendingThreadDeletes.get(resolvedRequestId) || "").trim();
  if (resolvedRequestId) state.pendingThreadDeletes.delete(resolvedRequestId);
  if (resolvedThreadId) state.deletingThreadIds.delete(resolvedThreadId);
  return resolvedThreadId;
}

function clearDeletedThreadBrowserState(threadId) {
  const id = String(threadId || "").trim();
  if (!id) return;
  sessionStorage.removeItem(threadUiStorageKey(id));
  sessionStorage.removeItem(`codexScroll:${id}`);
  sessionStorage.removeItem(threadToolStorageKey(id));
  localStorage.removeItem(collaborationModeStorageKey(id));
}

function resetActiveThreadAfterDeletion(threadId) {
  const deletedId = String(threadId || state.threadId || "").trim();
  clearDeletedThreadBrowserState(deletedId);
  clearTranscript(false);
  state.outlineObserver?.disconnect();
  state.outlineObserver = null;
  state.outlineNodes.clear();
  state.activeOutlineNode = null;
  state.activeOutlineMessageId = null;
  state.commandItems.clear();
  state.changeItems.clear();
  state.threadView = normalizeThread({});
  state.threadUi = null;
  state.lastSavedThreadUi = null;
  state.threadId = null;
  state.activeTurnId = null;
  state.running = false;
  state.threadStatus = "notLoaded";
  state.threadMeta = {};
  state.tokenUsage = null;
  state.tokenUsageThreadId = null;
  state.latestGuardianDenial = null;
  state.mcpStartupStatuses = {};
  state.currentTurn = null;
  state.latestUserInput = "";
  state.turnDiff = "";
  state.latestDiff = "";
  state.approvals = [];
  state.navigation = removeThreadFromNavigation(state.navigation, deletedId);
  state.navigatingHistory = false;
  state.expandedFileChanges.clear();
  state.expandedDiffFiles.clear();
  state.expandedCommands.clear();
  state.collapsedCommands.clear();
  state.expandedCommandGroups.clear();
  state.expandedMcpTools.clear();
  state.expandedCommandOutputs.clear();
  state.expandedProcesses.clear();
  clearQueuedMessages();
  localStorage.removeItem("codexMathThreadId");
  threadIdInput.value = "";
  chat.append(chatEmptyState);
  renderConversationOutline();
  renderChangesView();
  renderCommandsView();
}

function handleThreadDeleted(payload) {
  const requestId = String(payload.requestId || "").trim();
  const threadId = removePendingThreadDelete(requestId, payload.threadId);
  if (!threadId) return;

  state.threads = removeThreadById(state.threads, threadId);
  state.navigation = removeThreadFromNavigation(state.navigation, threadId);
  if (threadId === state.threadId) resetActiveThreadAfterDeletion(threadId);
  else clearDeletedThreadBrowserState(threadId);
  renderThreadList();
  refreshThreadList();
  updateControls();
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
        const item = document.createElement("div");
        item.dataset.threadId = thread.id;
        item.className = `thread-item${thread.id === state.threadId ? " active" : ""}`;
        item.title = `${threadTitle(thread, 500)}\n${thread.cwd || thread.id}`;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "thread-item-main";
        button.disabled = state.running;
        button.title = item.title;
        button.setAttribute("aria-current", thread.id === state.threadId ? "true" : "false");

        const title = document.createElement("span");
        title.className = "thread-item-title";
        title.textContent = threadTitle(thread);
        const time = document.createElement("time");
        time.className = "thread-item-time";
        time.textContent = formatThreadTime(thread);
        const cwd = document.createElement("span");
        cwd.className = "thread-item-cwd";
        cwd.textContent = compactThreadCwd(thread.cwd) || "Unknown directory";
        cwd.title = thread.cwd || "Working directory unavailable";
        button.append(title, time, cwd);
        button.addEventListener("click", () => {
          if (thread.id !== state.threadId) resumeThread(thread.id);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "thread-item-delete icon-button";
        deleteButton.setAttribute("aria-label", `Delete ${threadTitle(thread)}`);
        deleteButton.title = "Delete conversation";
        deleteButton.disabled = state.deletingThreadIds.has(thread.id)
          || (state.running && thread.id === state.threadId);
        deleteButton.setAttribute("aria-busy", String(state.deletingThreadIds.has(thread.id)));
        const deleteIcon = document.createElement("i");
        deleteIcon.dataset.icon = "trash-2";
        deleteButton.append(deleteIcon);
        renderIcons(deleteButton);
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          openDeleteThreadDialog(thread);
        });

        item.append(button, deleteButton);
        section.append(item);
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

function syncThreadListControls() {
  for (const button of threadList.querySelectorAll(".thread-item-main")) {
    const item = button.closest(".thread-item");
    const threadId = item?.dataset.threadId || "";
    const active = threadId === state.threadId;
    button.disabled = state.running;
    item?.classList.toggle("active", active);
    button.setAttribute("aria-current", String(active));
    const deleteButton = item?.querySelector(".thread-item-delete");
    if (deleteButton) {
      deleteButton.disabled = state.deletingThreadIds.has(threadId)
        || (state.running && active);
      deleteButton.setAttribute("aria-busy", String(state.deletingThreadIds.has(threadId)));
    }
  }
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
  state.conversationOrder.push({ kind: "barrier", turnId: state.activeTurnId ?? null });
  const node = document.createElement("div");
  node.className = `system-message system-${kind}`;
  node.textContent = text;
  chat.append(node);
  scrollToBottom();
}

function renderMarkdown(node, raw, { preserveLineBreaks = false } = {}) {
  const extracted = extractMath(raw || "");
  const html = marked.parse(extracted.markdown, preserveLineBreaks ? { breaks: true } : undefined);
  node.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-codex-math"],
  });
  renderMathSlots(node, extracted.formulas, katex, mathRenderCache);
}

function clearStreamingTail(record) {
  for (const node of record.streamTailNodes || []) node.remove();
  record.streamTailNodes = [];
}

function processKey(turnId = state.activeTurnId) {
  return `${state.threadId || "thread"}:${turnId || "turn"}`;
}

function updateProcessSummary(record) {
  if (!record) return;
  const count = record.itemIds.size;
  const toolCount = [...record.itemIds].filter((id) => state.toolNodes.get(id)).length;
  const durations = [...record.itemIds]
    .map((id) => state.toolNodes.get(id)?.item?.durationMs)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const duration = durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
  const parts = [`Process details`, `${count} item${count === 1 ? "" : "s"}`];
  if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  if (duration !== null) parts.push(durationLabel(duration));
  record.summaryText.textContent = parts.join(" · ");
}

function ensureProcessDetails(turnId = state.activeTurnId, container = chat) {
  const key = processKey(turnId);
  let record = state.processNodes.get(key);
  if (record) return record;
  const details = document.createElement("details");
  details.className = "process-details";
  details.dataset.processKey = key;
  const summary = document.createElement("summary");
  summary.className = "process-details-summary";
  const chevron = document.createElement("span");
  chevron.className = "process-details-chevron";
  chevron.textContent = "›";
  const summaryText = document.createElement("span");
  summaryText.className = "process-details-text";
  const body = document.createElement("div");
  body.className = "process-details-body";
  summary.append(chevron, summaryText);
  details.append(summary, body);
  record = { key, turnId, details, summary, summaryText, body, itemIds: new Set() };
  details.open = state.expandedProcesses.has(key);
  details.addEventListener("toggle", () => {
    if (details.open) state.expandedProcesses.add(key);
    else state.expandedProcesses.delete(key);
    saveThreadUi();
  });
  (container || chat).append(details);
  state.processNodes.set(key, record);
  updateProcessSummary(record);
  return record;
}

function registerProcessItem(item, record = null) {
  if (!item?.id) return record;
  const process = record || ensureProcessDetails(item.turnId || state.activeTurnId);
  process.itemIds.add(item.id);
  updateProcessSummary(process);
  return process;
}

function promoteAssistantAnswer(record) {
  if (!record?.article || !record.process) return;
  if (record.article.parentElement === record.process.body) chat.append(record.article);
  record.process.itemIds.delete(record.id);
  updateProcessSummary(record.process);
  record.process = null;
}

function promoteLatestAssistantAnswer(turnId = state.currentTurn?.id || state.activeTurnId) {
  const records = [...state.messageNodes.values()].filter((record) => {
    if (record.role !== "assistant") return false;
    if (!turnId) return true;
    return record.turnId === turnId || record.process?.turnId === turnId;
  });
  promoteAssistantAnswer(records.at(-1));
}

function renderStreamingMessage(record) {
  const raw = record.raw;
  const stableEnd = findStableMarkdownBoundary(raw, record.streamPrefixLength);
  if (stableEnd > record.streamPrefixLength) {
    clearStreamingTail(record);
    const segment = document.createElement("div");
    renderMarkdown(segment, raw.slice(record.streamPrefixLength, stableEnd));
    record.content.append(...segment.childNodes);
    record.streamPrefixLength = stableEnd;
  }

  clearStreamingTail(record);
  const tail = raw.slice(record.streamPrefixLength);
  if (tail) {
    const node = document.createElement("div");
    node.className = "streaming-tail";
    node.textContent = tail;
    record.content.append(node);
    record.streamTailNodes = [node];
  }
  record.streamNeedsFinalRender = Boolean(tail);
  record.renderedRaw = raw;
}

function resetStreamingMessage(record) {
  clearStreamingTail(record);
  record.streaming = false;
  record.streamPrefixLength = 0;
  record.streamNeedsFinalRender = false;
}

function renderCompletedMessage(record, raw) {
  const needsFullRender = record.renderedRaw !== raw || record.streamNeedsFinalRender;
  if (needsFullRender) {
    clearStreamingTail(record);
    renderMarkdown(record.content, raw);
  }
  resetStreamingMessage(record);
  record.renderedRaw = raw;
}

function scheduleRender(record) {
  if (state.renderTimers.has(record.id)) return;
  const timer = setTimeout(() => {
    state.renderTimers.delete(record.id);
    if (record.streaming) renderStreamingMessage(record);
    else if (record.renderedRaw !== record.raw) {
      renderMarkdown(record.content, record.raw);
      record.renderedRaw = record.raw;
    }
    scrollToBottom();
  }, 80);
  state.renderTimers.set(record.id, timer);
}

function ensureMessage(id, role, meta = {}) {
  let record = state.messageNodes.get(id);
  if (record) {
    if (meta.turnId && !record.turnId) record.turnId = meta.turnId;
    if (role === "assistant" && meta.process === true && !record.process) {
      const process = ensureProcessDetails(meta.turnId ?? state.activeTurnId ?? record.turnId);
      process.body.append(record.article);
      process.itemIds.add(record.id);
      record.process = process;
      updateProcessSummary(process);
    }
    return record;
  }

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
  const turnId = meta.turnId ?? state.activeTurnId ?? state.currentTurn?.id;
  const process = role === "assistant" && meta.process !== false && (meta.live !== false ? meta.process !== false : meta.process === true)
    ? ensureProcessDetails(turnId)
    : null;
  (process?.body || chat).append(article);
  renderIcons(head);

  record = {
    id,
    role,
    raw: "",
    renderedRaw: "",
    article,
    content,
    time,
    streaming: false,
    streamPrefixLength: 0,
    streamNeedsFinalRender: false,
    streamTailNodes: [],
    process,
    turnId,
  };
  state.messageNodes.set(id, record);
  if (process) {
    process.itemIds.add(id);
    updateProcessSummary(process);
  }
  if (meta.live !== false) state.conversationOrder.push({ kind: "barrier", id, turnId: turnId ?? null });
  if (role === "user" && !meta.deferOutline) renderConversationOutline();
  return record;
}

function addLocalUserMessage(input) {
  const id = `local-user-${crypto.randomUUID()}`;
  const record = ensureMessage(id, "user");
  record.raw = Array.isArray(input) ? displayInput(input) : String(input || "");
  renderMarkdown(record.content, record.raw, { preserveLineBreaks: true });
  record.renderedRaw = record.raw;
  renderConversationOutline();
  scrollToBottom(true);
}

function toolTitle(item) {
  switch (item.type) {
    case "commandExecution":
      return presentCommand(item).summary;
    case "fileChange":
      return "Changed files";
    case "mcpToolCall":
      return `MCP · ${item.server || "server"} / ${item.tool || "tool"}`;
    default:
      return item.type || "Tool event";
  }
}

function searchQuery(item) {
  const action = item?.action;
  const queries = Array.isArray(action?.queries) ? action.queries : [];
  const value = item?.query || action?.query || queries[0] || "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function searchStepTitle(item, isActive) {
  if (item?.type === "webSearch") return isActive ? "Searching web..." : "Web search";
  return isActive ? "Searching files..." : "File search";
}

function searchResultText(item) {
  const value = item?.results ?? item?.result ?? item?.output ?? item?.response ?? item?.aggregatedOutput;
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return "[unserializable search result]"; }
}

function renderSearchDetails(record) {
  if (!record.card.open) {
    record.body.replaceChildren();
    return;
  }
  record.body.replaceChildren();
  const queryLabel = document.createElement("div");
  queryLabel.className = "search-step-detail-label";
  queryLabel.textContent = "Query";
  const query = document.createElement("pre");
  query.className = "search-step-detail-value";
  query.textContent = record.rawQuery || "(empty query)";
  record.body.append(queryLabel, query);
  const statusLabel = document.createElement("div");
  statusLabel.className = "search-step-detail-label";
  statusLabel.textContent = "Status";
  const status = document.createElement("pre");
  status.className = "search-step-detail-value search-step-status-detail";
  const normalizedStatus = normalizeToolStatus(record.item?.status);
  status.textContent = record.statusLabel || normalizedStatus.label;
  record.body.append(statusLabel, status);
  if (record.resultText) {
    const resultLabel = document.createElement("div");
    resultLabel.className = "search-step-detail-label";
    resultLabel.textContent = "Results";
    const results = document.createElement("pre");
    results.className = "search-step-detail-value search-step-results";
    results.textContent = record.resultText;
    record.body.append(resultLabel, results);
  }
}

function updateSearchStep(item, options = {}) {
  if (!item?.id || item.type !== "webSearch") return null;
  let record = state.searchNodes.get(item.id);
  if (!record) {
    const card = document.createElement("details");
    card.className = "search-step";
    card.dataset.itemId = item.id;
    const summary = document.createElement("summary");
    summary.className = "search-step-summary";
    const tool = document.createElement("span");
    tool.className = "search-step-tool search-step-title";
    tool.textContent = "web_search";
    const query = document.createElement("span");
    query.className = "search-step-query";
    const duration = document.createElement("span");
    duration.className = "search-step-duration";
    const status = document.createElement("span");
    status.className = "search-step-status";
    status.setAttribute("role", "status");
    const chevron = document.createElement("span");
    chevron.className = "search-step-chevron command-step-chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");
    // Keep the summary's reading order stable: tool, raw input, duration,
    // status, then the disclosure arrow.
    summary.append(tool, query, duration, status, chevron);
    const body = document.createElement("div");
    body.className = "search-step-body";
    card.append(summary, body);
    const target = options.container || (options.process === true || options.live !== false
      ? ensureProcessDetails(options.turnId || item.turnId || state.activeTurnId).body
      : chat);
    target.append(card);
    record = {
      kind: "search",
      card,
      summary,
      tool,
      title: tool,
      query,
      duration,
      status,
      chevron,
      body,
      item,
      rawQuery: "",
      resultText: "",
    };
    state.searchNodes.set(item.id, record);
    card.addEventListener("toggle", () => {
      renderSearchDetails(record);
      scrollToBottom();
    });
    if (options.process === true || options.live !== false) registerProcessItem(item);
  }
  record.item = item;
  const normalizedStatus = normalizeToolStatus(item.status || (options.active ? "inProgress" : "completed"));
  const isActive = options.active ?? normalizedStatus.isActive;
  const query = searchQuery(item);
  if (isActive && !state.commandObservedStartMs.has(item.id)) state.commandObservedStartMs.set(item.id, Date.now());
  if (!isActive && state.commandObservedStartMs.has(item.id)) record.finishedAtMs ||= Date.now();
  const durationMs = toolDurationMs(item, record);
  record.rawQuery = query;
  record.resultText = searchResultText(item);
  record.active = isActive;
  record.card.dataset.status = normalizedStatus.kind;
  record.card.classList.toggle("search-step-running", isActive);
  record.tool.textContent = "web_search";
  record.title.textContent = "web_search";
  record.query.textContent = toolInputPreview(item, { maxLength: 180 }) || "(empty query)";
  record.query.title = query || "(empty query)";
  record.duration.textContent = durationLabel(durationMs);
  record.status.textContent = "";
  record.status.setAttribute("aria-label", normalizedStatus.label);
  record.status.dataset.label = normalizedStatus.label;
  record.status.dataset.kind = normalizedStatus.kind;
  record.statusLabel = normalizedStatus.label;
  if (record.card.open) renderSearchDetails(record);
  ensureCommandDurationTimer();
  updateProcessSummary(record.process);
  return record;
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
  } else {
    state.expandedFileChanges.delete(item.id);
  }
  record.details.classList.toggle("expanded", expanded);
  record.body.hidden = !expanded;
  saveThreadUi();
}

function toolDurationMs(item, record) {
  const explicit = item?.durationMs;
  if (explicit !== null && explicit !== undefined && explicit !== "" && Number.isFinite(Number(explicit))) return Number(explicit);
  if (Number.isFinite(record?.observedDurationMs)) return record.observedDurationMs;
  const started = state.commandObservedStartMs.get(item?.id);
  if (!Number.isFinite(started)) return undefined;
  const finished = record?.finishedAtMs || Date.now();
  return Math.max(0, finished - started);
}

function ensureCommandDurationTimer() {
  if (state.commandDurationTimer) return;
  state.commandDurationTimer = setInterval(() => {
    let active = false;
    const records = [...state.toolNodes.values(), ...state.searchNodes.values()];
    for (const record of records) {
      if (record.kind !== "command" && record.kind !== "search") continue;
      const status = normalizeToolStatus(record.item?.status);
      if (!status.isActive && !record.active) continue;
      active = true;
      const duration = toolDurationMs(record.item, record);
      if (Number.isFinite(duration)) record.duration.textContent = durationLabel(duration);
    }
    if (!active) {
      clearInterval(state.commandDurationTimer);
      state.commandDurationTimer = null;
    }
  }, 1000);
}

function rememberToolStart(item, record) {
  const status = normalizeToolStatus(item?.status);
  if (status.isActive) {
    if (!state.commandObservedStartMs.has(item.id)) state.commandObservedStartMs.set(item.id, Date.now());
    ensureCommandDurationTimer();
  } else if (state.commandObservedStartMs.has(item.id)) {
    record.finishedAtMs ||= Date.now();
    if (!(item.durationMs !== null && item.durationMs !== undefined && item.durationMs !== "" && Number.isFinite(Number(item.durationMs)))) record.observedDurationMs = toolDurationMs(item, record);
  }
}

function setCommandPersistence(record, open) {
  const defaultOpen = false;
  if (open) {
    state.expandedCommands.add(record.item.id);
    state.collapsedCommands.delete(record.item.id);
  } else {
    state.expandedCommands.delete(record.item.id);
    if (defaultOpen) state.collapsedCommands.add(record.item.id);
  }
  saveThreadUi();
}

function setMcpPersistence(record, open) {
  if (open) state.expandedMcpTools.add(record.item.id);
  else state.expandedMcpTools.delete(record.item.id);
  saveThreadUi();
}

function commandDefaultOpen(item) {
  // Process details and individual tool rows start collapsed for every
  // status. The status color and duration remain visible in the summary.
  return false;
}

function appendCommandField(container, label, value, className = "command-step-field") {
  const field = document.createElement("div");
  field.className = className;
  const name = document.createElement("span");
  name.className = "command-step-field-label";
  name.textContent = label;
  const content = document.createElement("span");
  content.className = "command-step-field-value";
  content.textContent = value;
  content.title = value;
  field.append(name, content);
  container.append(field);
  return content;
}

function createCommandStep(item, container = chat) {
  const details = document.createElement("details");
  details.className = "command-step";
  details.dataset.itemId = item.id;
  const summary = document.createElement("summary");
  summary.className = "command-step-summary";
  const chevron = document.createElement("span");
  chevron.className = "command-step-chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  const summaryText = document.createElement("span");
  summaryText.className = "command-step-title";
  const environment = document.createElement("span");
  environment.className = "command-step-environment";
  const status = document.createElement("span");
  status.className = "command-step-status";
  status.setAttribute("role", "status");
  const duration = document.createElement("span");
  duration.className = "command-step-duration";
  // The collapsed row reads as tool, raw input, duration, status, arrow.
  summary.append(environment, summaryText, duration, status, chevron);

  const body = document.createElement("div");
  body.className = "command-step-body";
  const meta = document.createElement("div");
  meta.className = "command-step-meta";
  const cwd = document.createElement("span");
  const exit = document.createElement("span");
  const statusDetail = document.createElement("span");
  statusDetail.className = "command-step-status-detail";
  const raw = document.createElement("pre");
  raw.className = "command-raw";
  raw.title = "Raw command";
  const outputBlock = document.createElement("div");
  outputBlock.className = "command-output-block";
  const outputHint = document.createElement("div");
  outputHint.className = "command-output-hint";
  const outputTail = document.createElement("pre");
  outputTail.className = "command-output-preview";
  const outputDetails = document.createElement("details");
  outputDetails.className = "command-output-details";
  const outputSummary = document.createElement("summary");
  outputSummary.textContent = "View full output";
  const fullOutput = document.createElement("pre");
  fullOutput.className = "command-output-full";
  outputDetails.append(outputSummary, fullOutput);
  outputBlock.append(outputHint, outputTail, outputDetails);
  meta.append(cwd, exit, statusDetail);
  body.append(meta, raw, outputBlock);
  details.append(summary, body);

  const record = {
    kind: "command",
    details,
    summary,
    summaryText,
    environment,
    status,
    duration,
    body,
    meta,
    cwd,
    exit,
    statusDetail,
    raw,
    outputBlock,
    outputHint,
    outputTail,
    outputDetails,
    fullOutput,
    item,
    presentation: null,
    group: null,
    ignoreNextToggle: true,
  };
  details.open = commandDefaultOpen(item) && !state.collapsedCommands.has(item.id) || state.expandedCommands.has(item.id);
  details.addEventListener("toggle", () => {
    if (record.ignoreNextToggle) {
      record.ignoreNextToggle = false;
      return;
    }
    setCommandPersistence(record, details.open);
    if (details.open) patchCommandStep(record, record.item);
    scrollToBottom();
  });
  outputDetails.open = state.expandedCommandOutputs.has(item.id);
  outputDetails.addEventListener("toggle", () => {
    if (outputDetails.open) state.expandedCommandOutputs.add(item.id);
    else state.expandedCommandOutputs.delete(item.id);
    if (outputDetails.open) fullOutput.textContent = record.item?.aggregatedOutput || "";
    saveThreadUi();
  });
  if (container) container.append(details);
  patchCommandStep(record, item);
  return record;
}

function patchCommandStep(record, item) {
  const previousStatus = normalizeToolStatus(record.item?.status);
  record.item = item;
  rememberToolStart(item, record);
  const durationMs = toolDurationMs(item, record);
  const model = presentCommand(item, { durationMs });
  record.presentation = model;
  record.details.dataset.status = model.normalizedStatus.kind;
  record.details.classList.toggle("command-step-running", model.normalizedStatus.isActive);
  record.details.classList.toggle("command-step-failed", model.normalizedStatus.isFailure);
  record.summaryText.textContent = model.inputPreview || model.rawCommand || model.summary;
  record.summaryText.title = model.rawCommand || model.inputPreview || "Tool input";
  const displayToolName = item.type === "commandExecution"
    ? model.toolName
    : item.toolName || model.toolName || (item.type === "read" ? "read" : item.type === "webSearch" ? "web_search" : "bash");
  record.environment.textContent = displayToolName;
  record.status.textContent = "";
  record.status.setAttribute("aria-label", model.normalizedStatus.label);
  record.status.dataset.label = model.normalizedStatus.label;
  record.status.dataset.kind = model.normalizedStatus.kind;
  record.statusDetail.textContent = `Status: ${model.normalizedStatus.label}`;
  record.duration.textContent = durationLabel(durationMs);
  record.cwd.textContent = `cwd: ${item.cwd || "--"}`;
  record.cwd.title = item.cwd || "--";
  record.exit.textContent = `exit: ${item.exitCode ?? "--"}`;
  record.raw.textContent = model.rawCommand || model.inputPreview || "(empty input)";
  record.raw.title = model.rawCommand || model.inputPreview || "Raw tool input";
  const output = item.aggregatedOutput || "";
  const lineCount = countOutputLines(output);
  const tailLimit = model.normalizedStatus.isFailure ? 18 : model.normalizedStatus.isActive ? 5 : 5;
  const tail = tailOutputLines(output, tailLimit).join("\n");
  const searching = model.category === "search" && model.normalizedStatus.isActive;
  record.outputBlock.hidden = !output && !searching;
  record.outputHint.textContent = output
    ? `${model.normalizedStatus.isActive ? "Recent" : "Output"} · ${lineCount} line${lineCount === 1 ? "" : "s"}`
    : searching ? "Searching..." : "";
  record.outputTail.hidden = !output;
  record.outputTail.textContent = tail;
  record.outputDetails.hidden = !output;
  if (record.outputDetails.open) record.fullOutput.textContent = output;
  if (previousStatus.isActive && model.normalizedStatus.kind === "completed" && !state.expandedCommands.has(item.id) && !state.collapsedCommands.has(item.id)) {
    record.details.open = false;
  }
  if (model.normalizedStatus.isFailure) record.details.classList.add("command-step-failed");
  updateProcessSummary(record.process);
}

function mcpPayload(item) {
  const fields = [
    ["Params", item.arguments ?? item.params ?? item.parameters ?? item.input],
    ["Result", item.result ?? item.output ?? item.response],
    ["Error", item.error ?? item.errorMessage ?? item.failureReason],
  ];
  return fields.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => {
    let text;
    if (typeof value === "string") text = value;
    else {
      try { text = JSON.stringify(value, null, 2); } catch { text = "[unserializable value]"; }
    }
    return { label, text };
  });
}

function createMcpStep(item, container = chat) {
  const details = document.createElement("details");
  details.className = "mcp-step";
  details.dataset.itemId = item.id;
  const summary = document.createElement("summary");
  summary.className = "mcp-step-summary";
  const chevron = document.createElement("span");
  chevron.className = "command-step-chevron";
  chevron.textContent = "›";
  const title = document.createElement("span");
  title.className = "mcp-step-title";
  const environment = document.createElement("span");
  environment.className = "command-step-environment";
  environment.textContent = "MCP";
  const status = document.createElement("span");
  status.className = "command-step-status";
  status.setAttribute("role", "status");
  const duration = document.createElement("span");
  duration.className = "command-step-duration";
  summary.append(environment, title, duration, status, chevron);
  const body = document.createElement("div");
  body.className = "mcp-step-body";
  details.append(summary, body);
  const record = { kind: "mcp", details, summary, title, environment, status, duration, body, item, ignoreNextToggle: true };
  details.open = commandDefaultOpen(item) || state.expandedMcpTools.has(item.id);
  details.addEventListener("toggle", () => {
    if (record.ignoreNextToggle) {
      record.ignoreNextToggle = false;
      return;
    }
    setMcpPersistence(record, details.open);
    scrollToBottom();
  });
  container.append(details);
  patchMcpStep(record, item);
  return record;
}

function patchMcpStep(record, item) {
  record.item = item;
  const normalizedStatus = normalizeToolStatus(item.status);
  record.details.dataset.status = normalizedStatus.kind;
  const model = presentTool(item, { maxLength: 180 });
  record.environment.textContent = "mcp";
  record.title.textContent = model.inputPreview || `${item.server || "server"} / ${item.tool || "tool"}`;
  record.title.title = model.rawInput || "MCP input";
  record.status.textContent = "";
  record.status.setAttribute("aria-label", normalizedStatus.label);
  record.status.dataset.label = normalizedStatus.label;
  record.status.dataset.kind = normalizedStatus.kind;
  record.duration.textContent = durationLabel(item.durationMs);
  record.body.replaceChildren();
  const meta = document.createElement("div");
  meta.className = "mcp-step-meta";
  appendCommandField(meta, "server", item.server || "--", "mcp-step-field");
  appendCommandField(meta, "tool", item.tool || "--", "mcp-step-field");
  appendCommandField(meta, "Status", normalizedStatus.label, "mcp-step-field");
  record.body.append(meta);
  for (const field of mcpPayload(item)) {
    const label = document.createElement("div");
    label.className = "mcp-payload-label";
    label.textContent = field.label;
    const value = document.createElement("pre");
    value.className = "mcp-payload";
    value.textContent = field.text;
    record.body.append(label, value);
  }
  updateProcessSummary(record.process);
}

function registerConversationTool(record, options = {}) {
  if (options.live === false || record.orderEntry) return;
  const previous = state.conversationOrder.at(-1);
  record.orderEntry = {
    kind: "tool",
    record,
    turnId: options.turnId ?? state.activeTurnId ?? record.item?.turnId ?? null,
    previousItemId: previous?.record?.item?.id || previous?.id || null,
    sequence: state.toolCacheSequence++,
  };
  state.conversationOrder.push(record.orderEntry);
}

function commandGroupTitle(records) {
  const categories = new Set(records.map((record) => record.presentation?.category));
  if (categories.has("search")) return "搜索项目代码";
  if (categories.has("read")) return "查看相关文件";
  return "检查现有实现";
}

function commandGroupDuration(records) {
  const durations = records.map((record) => toolDurationMs(record.item, record)).filter((value) => Number.isFinite(value));
  return durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
}

function createCommandGroup(id, turnId, container = chat) {
  const details = document.createElement("details");
  details.className = "command-group";
  details.dataset.groupId = id;
  const summary = document.createElement("summary");
  summary.className = "command-group-summary";
  const chevron = document.createElement("span");
  chevron.className = "command-step-chevron";
  chevron.textContent = "›";
  const title = document.createElement("span");
  title.className = "command-group-title";
  const count = document.createElement("span");
  count.className = "command-group-count";
  const more = document.createElement("span");
  more.className = "command-group-more";
  const duration = document.createElement("span");
  duration.className = "command-step-duration";
  summary.append(chevron, title, count, more, duration);
  const items = document.createElement("div");
  items.className = "command-group-items";
  details.append(summary, items);
  const group = { kind: "commandGroup", id, turnId, details, summary, title, count, more, duration, items, entries: [] };
  details.open = state.expandedCommandGroups.has(id);
  details.addEventListener("toggle", () => {
    if (group.ignoreNextToggle) {
      group.ignoreNextToggle = false;
      return;
    }
    if (details.open) state.expandedCommandGroups.add(id);
    else state.expandedCommandGroups.delete(id);
    saveThreadUi();
    scrollToBottom();
  });
  if (container) container.append(details);
  group.ignoreNextToggle = true;
  return group;
}

function updateCommandGroupSummary(group) {
  const entries = group.entries;
  group.title.textContent = commandGroupTitle(entries);
  group.count.textContent = `${entries.length} commands`;
  group.more.textContent = entries.length > 5 ? `+${entries.length - 5} more` : "";
  const duration = commandGroupDuration(entries);
  group.duration.textContent = durationLabel(duration);
}

function addCommandToGroup(group, record) {
  if (record.group === group) return;
  record.group = group;
  record.details.classList.add("command-step-nested");
  group.entries.push(record);
  group.items.append(record.details);
  updateCommandGroupSummary(group);
}

function maybeGroupLiveCommand(record, item) {
  if (record.group || !isGroupableReadonlyCommand({ ...item, status: record.presentation?.normalizedStatus.kind, durationMs: toolDurationMs(item, record) })) return;
  const index = state.conversationOrder.indexOf(record.orderEntry);
  const previous = index > 0 ? state.conversationOrder[index - 1] : null;
  const previousRecord = previous?.record;
  if (!previous || previous.turnId !== record.orderEntry.turnId || previousRecord?.kind !== "command") return;
  if (!isGroupableReadonlyCommand({ ...previousRecord.item, status: previousRecord.presentation?.normalizedStatus.kind, durationMs: toolDurationMs(previousRecord.item, previousRecord) })) return;
  if (previousRecord.group) {
    addCommandToGroup(previousRecord.group, record);
    return;
  }
  const group = createCommandGroup(commandGroupId(record.orderEntry.turnId, previousRecord.item.id), record.orderEntry.turnId, null);
  previousRecord.details.replaceWith(group.details);
  addCommandToGroup(group, previousRecord);
  addCommandToGroup(group, record);
}

function ensureTool(item, options = {}) {
  let record = state.toolNodes.get(item.id);
  if (record) return record;
  const process = options.process === true || (options.process !== false && options.live !== false)
    ? ensureProcessDetails(options.turnId ?? item.turnId ?? state.activeTurnId)
    : null;
  const targetContainer = options.container || process?.body || chat;
  if (item.type === "fileChange") {
    const card = document.createElement("section");
    card.className = "tool-card file-change-card";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "file-change-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const body = document.createElement("div");
    body.className = "file-change-body";
    card.append(toggle, body);
    targetContainer.append(card);
    record = { kind: "fileChange", details: card, summary: toggle, body, item, fileList: null, normalizedFiles: null, process };
    toggle.addEventListener("click", () => {
      const currentItem = record.item || item;
      setFileChangeExpanded(record, currentItem, !state.expandedFileChanges.has(currentItem.id));
      renderToolFileChange(record, currentItem);
      toggle.setAttribute("aria-expanded", String(state.expandedFileChanges.has(currentItem.id)));
    });
    state.toolNodes.set(item.id, record);
    if (process) registerProcessItem(item, process);
    registerConversationTool(record, options);
    renderToolFileChange(record, item);
    return record;
  }
  if (item.type === "mcpToolCall") record = createMcpStep(item, targetContainer);
  else record = createCommandStep(item, targetContainer);
  record.process = process;
  state.toolNodes.set(item.id, record);
  if (process) registerProcessItem(item, process);
  registerConversationTool(record, options);
  return record;
}

function renderDiffFileIfNeeded(details, container, file) {
  if (details.open && !container.childElementCount) renderDiffRows(container, file);
}

function sameFileChanges(previous, next) {
  return Array.isArray(previous)
    && previous.length === next.length
    && previous.every((file, index) => {
      const current = next[index];
      return file.id === current.id
        && file.path === current.path
        && file.kind === current.kind
        && file.diff === current.diff;
    });
}

function sameFileChangeStructure(previous, next) {
  return Array.isArray(previous)
    && previous.length === next.length
    && previous.every((file, index) => {
      const current = next[index];
      return file.id === current.id && file.path === current.path && file.kind === current.kind;
    });
}

function renderFileChangeHeader(record, item, files) {
  const expanded = state.expandedFileChanges.has(item.id);
  const normalizedStatus = normalizeToolStatus(item.status);
  record.details.classList.toggle("expanded", expanded);
  record.details.dataset.status = normalizedStatus.kind;
  record.body.hidden = !expanded;
  record.summary.setAttribute("aria-expanded", String(expanded));
  let [chevron, label, added, removed, status] = record.summary.children;
  if (record.summary.children.length !== 5) {
    record.summary.replaceChildren();
    chevron = document.createElement("span");
    chevron.className = "file-change-chevron";
    chevron.setAttribute("aria-hidden", "true");
    label = document.createElement("span");
    label.className = "file-change-label";
    added = document.createElement("span");
    added.className = "file-change-stat-add";
    removed = document.createElement("span");
    removed.className = "file-change-stat-del";
    status = document.createElement("span");
    status.className = "file-change-status";
    record.summary.append(chevron, label, added, removed, status);
  }
  chevron.textContent = "›";
  label.textContent = fileChangeLabel(files.length);
  added.textContent = `+${files.reduce((sum, file) => sum + file.additions, 0)}`;
  removed.textContent = `-${files.reduce((sum, file) => sum + file.deletions, 0)}`;
  status.textContent = normalizedStatus.label;
  status.dataset.kind = normalizedStatus.kind;
}

function renderToolFileChange(record, item) {
  const files = normalizeFileChanges(item);
  renderFileChangeHeader(record, item, files);
  if (record.fileList && sameFileChanges(record.normalizedFiles, files)) return;
  if (record.fileList && sameFileChangeStructure(record.normalizedFiles, files)) {
    record.normalizedFiles = files;
    [...record.fileList.children].forEach((details, index) => {
      const file = files[index];
      const stats = details.querySelector(".tool-file-stats");
      if (stats) stats.textContent = `+${file.additions} / -${file.deletions}`;
      const diff = details.querySelector(".tool-file-diff");
      if (!diff) return;
      diff.replaceChildren();
      renderDiffFileIfNeeded(details, diff, file);
    });
    return;
  }
  record.body.replaceChildren();
  record.fileList = null;
  record.normalizedFiles = files;
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "tool-file-empty";
    empty.textContent = "No file patch was reported.";
    record.body.append(empty);
    return;
  }

  const fileList = document.createElement("div");
  fileList.className = "tool-file-list";
  for (const file of files) {
    const key = `${item.id}:${file.id}`;
    const details = document.createElement("details");
    details.className = "tool-file";
    details.dataset.fileKey = key;
    details.open = state.expandedDiffFiles.has(key);
    const summary = document.createElement("summary");
    const chevron = document.createElement("span");
    chevron.className = "tool-file-chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");
    const titleWrap = document.createElement("span");
    titleWrap.className = "tool-file-title-wrap";
    const path = filePathParts(file.path);
    const name = document.createElement("strong");
    name.className = "tool-file-path";
    name.textContent = path.name;
    name.title = path.full;
    const relative = document.createElement("span");
    relative.className = "tool-file-relative-path";
    relative.textContent = path.relative === path.name ? "" : path.relative;
    relative.title = path.full;
    titleWrap.append(name, relative);
    const stats = document.createElement("span");
    stats.className = "tool-file-stats";
    stats.textContent = `+${file.additions} / -${file.deletions}`;
    summary.append(chevron, titleWrap, stats);
    details.append(summary);
    const diff = document.createElement("div");
    diff.className = "tool-file-diff";
    details.append(diff);
    details.addEventListener("toggle", () => {
      if (details.open) state.expandedDiffFiles.add(key);
      else state.expandedDiffFiles.delete(key);
      renderDiffFileIfNeeded(details, diff, file);
      saveThreadUi();
    });
    summary.addEventListener("click", (event) => event.stopPropagation());
    fileList.append(details);
    renderDiffFileIfNeeded(details, diff, file);
  }
  record.body.append(fileList);
  record.fileList = fileList;
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
  if (record.kind === "command") patchCommandStep(record, item);
}

function updateTool(item, options = {}) {
  if (!item?.id) return null;
  const record = ensureTool(item, { ...options, turnId: options.turnId ?? item.turnId ?? state.activeTurnId });
  if (item.type === "commandExecution") {
    state.commandItems.set(item.id, item);
    patchCommandStep(record, item);
    if (options.live !== false) maybeGroupLiveCommand(record, item);
    cacheToolItem(item, record, { ...options, turnId: options.turnId ?? record.orderEntry?.turnId });
    if (state.activeView === "commands") renderCommandsView();
  } else if (item.type === "fileChange") {
    record.item = item;
    state.changeItems.set(item.id, item);
    renderToolFileChange(record, item);
    cacheToolItem(item, record, { ...options, turnId: options.turnId ?? record.orderEntry?.turnId });
    if (state.activeView === "changes") renderChangesView();
  } else if (item.type === "mcpToolCall") {
    patchMcpStep(record, item);
    cacheToolItem(item, record, { ...options, turnId: options.turnId ?? record.orderEntry?.turnId });
  }
  return record;
}

function appendToolOutput(itemId, delta) {
  const record = state.toolNodes.get(itemId);
  const text = delta || "";
  const item = state.commandItems.get(itemId);
  if (!record || !item) return;
  item.aggregatedOutput = `${item.aggregatedOutput || ""}${text}`;
  if (!state.toolOutputTimers.has(itemId)) {
    const timer = setTimeout(() => {
      state.toolOutputTimers.delete(itemId);
      patchCommandStep(record, item);
      cacheToolItem(item, record, { turnId: record.orderEntry?.turnId });
      scheduleArtifactRender("commands");
    }, 80);
    state.toolOutputTimers.set(itemId, timer);
  }
  scheduleArtifactRender("commands");
  scrollToBottom();
}

function durationLabel(value) {
  if (value === null || value === undefined || value === "") return "--";
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "--";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function latestUserText() {
  const turn = state.threadView.latestTurn;
  return state.latestUserInput || turn?.items?.find((item) => item.role === "user")?.text || "Latest turn";
}

function createDiffLine(row) {
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
  return line;
}

function renderDiffRows(container, file, page = 1) {
  const visible = visibleDiffRows(file.rows, page);
  const scroll = document.createElement("div");
  scroll.className = "diff-scroll";
  for (const row of visible.rows) scroll.append(createDiffLine(row));
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

function planStepMarker(status) {
  if (status === "completed") return "✓";
  if (status === "inProgress") return "●";
  if (status === "pending") return "○";
  return "?";
}

function renderPlanCard(snapshot, { text = "", key = null, live = true } = {}) {
  const resolvedKey = key || planSnapshotKey(snapshot?.threadId || state.threadId, snapshot?.turnId || state.activeTurnId);
  let record = state.planNodes.get(resolvedKey);
  if (!record) {
    const card = document.createElement("section");
    card.className = "plan-card";
    card.dataset.planKey = resolvedKey;
    const head = document.createElement("div");
    head.className = "plan-card-head";
    const mark = document.createElement("span");
    mark.className = "plan-card-mark";
    mark.textContent = "C";
    const title = document.createElement("strong");
    title.className = "plan-card-title";
    title.textContent = "Updated Plan";
    const turn = document.createElement("span");
    turn.className = "plan-card-turn";
    head.append(mark, title, turn);
    const explanation = document.createElement("div");
    explanation.className = "plan-card-explanation";
    const body = document.createElement("div");
    body.className = "plan-card-body";
    body.setAttribute("aria-live", "polite");
    const actions = document.createElement("div");
    actions.className = "plan-card-actions";
    const implement = document.createElement("button");
    implement.type = "button";
    implement.className = "plan-card-action hidden";
    implement.title = "Switch to Default mode and implement this plan";
    const icon = document.createElement("i");
    icon.dataset.icon = "play";
    implement.append(icon, document.createTextNode("Implement plan"));
    implement.addEventListener("click", () => implementPlan(resolvedKey));
    actions.append(implement);
    card.append(head, explanation, body, actions);
    chat.append(card);
    renderIcons(card);
    record = { card, turn, explanation, body, actions, implement, text: "", key: resolvedKey, live };
    state.planNodes.set(resolvedKey, record);
    state.conversationOrder.push({ kind: "barrier", turnId: snapshot?.turnId || state.activeTurnId, planKey: resolvedKey });
  }

  if (live) state.latestPlanKey = resolvedKey;
  record.live ||= live;

  record.turn.textContent = snapshot?.turnId ? `Turn ${String(snapshot.turnId).slice(0, 8)}` : "";
  record.explanation.textContent = snapshot?.explanation || "";
  record.explanation.classList.toggle("hidden", !snapshot?.explanation);
  record.body.replaceChildren();
  const steps = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  if (steps.length) {
    const list = document.createElement("ol");
    list.className = "plan-step-list";
    for (const step of steps) {
      const row = document.createElement("li");
      row.className = `plan-step plan-step-${step.status || "unknown"}`;
      const marker = document.createElement("span");
      marker.className = "plan-step-marker";
      marker.textContent = planStepMarker(step.status);
      marker.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "plan-step-label";
      label.textContent = step.step;
      row.append(marker, label);
      list.append(row);
    }
    record.body.append(list);
  } else if (text) {
    const fallback = document.createElement("div");
    fallback.className = "plan-card-fallback markdown-body";
    renderMarkdown(fallback, text, { preserveLineBreaks: true });
    record.body.append(fallback);
  } else {
    const empty = document.createElement("div");
    empty.className = "plan-card-empty";
    empty.textContent = "Plan details are not available yet.";
    record.body.append(empty);
  }
  record.text = text;
  record.card.dataset.stepCount = String(steps.length);
  syncPlanActionVisibility();
  if (live) scrollToBottom();
  return record;
}

function upsertPlanSnapshot(params) {
  const snapshot = normalizePlanSnapshot(params, {
    threadId: state.threadId,
    turnId: state.activeTurnId,
  });
  const key = planSnapshotKey(snapshot.threadId || state.threadId, snapshot.turnId || state.activeTurnId);
  state.planSnapshots.set(key, snapshot);
  renderPlanCard(snapshot, { key });
}

function syncPlanActionVisibility() {
  for (const [key, record] of state.planNodes) {
    if (!record.implement) continue;
    const available = key === state.latestPlanKey && canImplementPlan({
      mode: currentCollaborationModeLabel(),
      running: state.running,
      turnStatus: state.currentTurn?.status,
      hasPlan: true,
    });
    record.implement.classList.toggle("hidden", !available);
    record.implement.disabled = !available;
  }
}

function implementPlan(planKey) {
  if (planKey !== state.latestPlanKey || !state.threadId) return;
  if (!canImplementPlan({
    mode: currentCollaborationModeLabel(),
    running: state.running,
    turnStatus: state.currentTurn?.status,
    hasPlan: state.planNodes.has(planKey),
  })) return;
  if (!setCollaborationMode("default")) return;
  sendComposedMessage([{ type: "text", text: PLAN_IMPLEMENTATION_PROMPT }], selectedSettings());
}

function syncApprovalAreaPosition() {
  if (!composer) return;
  const marginBottom = Number.parseFloat(window.getComputedStyle(composer).marginBottom) || 0;
  const offset = Math.ceil(composer.getBoundingClientRect().height + marginBottom + 12);
  approvalArea.style.setProperty("--approval-bottom", `${offset}px`);
}

function syncApprovalQueueMeta(card) {
  const queue = card.querySelector("[data-approval-queue]");
  if (!queue) return;
  const waiting = Math.max(0, state.approvals.length - 1);
  queue.textContent = waiting ? `${waiting} more waiting` : "";
  queue.classList.toggle("hidden", !waiting);
}

function renderApprovalQueue() {
  const request = currentApproval(state.approvals);
  const current = approvalArea.querySelector(".approval-card");
  if (!request || state.userInputRequest) {
    current?.remove();
    return;
  }
  if (current?.dataset.requestId === String(request.id)) {
    syncApprovalQueueMeta(current);
    return;
  }

  current?.remove();
  const { id, method, params = {} } = request;
  const card = document.createElement("section");
  card.className = "approval-card";
  card.dataset.requestId = String(id);
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", method.includes("fileChange") ? "Codex requests a file change" : "Codex requests an operation");

  const head = document.createElement("div");
  head.className = "approval-card-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "approval-card-title";
  const kicker = document.createElement("span");
  kicker.className = "eyebrow";
  kicker.textContent = "APPROVAL REQUIRED";
  const title = document.createElement("strong");
  title.textContent = method.includes("fileChange") ? "Codex requests a file change" : "Codex requests an operation";
  titleWrap.append(kicker, title);
  const queue = document.createElement("span");
  queue.className = "approval-card-queue";
  queue.dataset.approvalQueue = "true";
  head.append(titleWrap, queue);

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
      if (!send({ type: "approval", requestId: id, decision })) return;
      removeApproval(id);
    });
    actions.append(button);
  }
  card.append(head, description, actions);
  approvalArea.append(card);
  syncApprovalQueueMeta(card);
}

function removeApproval(requestId) {
  state.approvals = removeQueuedApproval(state.approvals, requestId);
  renderApprovalQueue();
}

function clearUserInputRequest() {
  state.userInputRequest = resetUserInputRequest(state.userInputRequest);
  approvalArea.querySelector(".user-input-card")?.remove();
  approvalArea.classList.remove("has-user-input");
  renderApprovalQueue();
}

function currentUserInputQuestion(request) {
  return request?.questions?.[request.index] || null;
}

function userInputAnswerFromCard(card) {
  const selectedOption = card.querySelector("input[data-user-input-option]:checked");
  const selectedOther = card.querySelector("input[data-user-input-other]:checked");
  const textInput = card.querySelector("[data-user-input-text]");
  if (selectedOption) return { type: "option", value: selectedOption.dataset.userInputOption };
  if (selectedOther || textInput) return { type: "text", value: textInput?.value || "" };
  return null;
}

function captureUserInputAnswer(card) {
  const request = state.userInputRequest;
  const question = currentUserInputQuestion(request);
  if (!request || !question || !card) return null;
  const answer = userInputAnswerFromCard(card);
  if (answer) request.answers.set(question.id, answer);
  else request.answers.delete(question.id);
  return answer;
}

function setUserInputError(card, message = "") {
  const error = card.querySelector(".user-input-error");
  if (!error) return;
  error.textContent = message;
  error.classList.toggle("hidden", !message);
}

function syncUserInputCard(card) {
  const request = state.userInputRequest;
  const question = currentUserInputQuestion(request);
  if (!request || !question || !card) return;
  const progress = card.querySelector(".user-input-progress");
  const answered = countUserInputAnswers(request.questions, request.answers);
  if (progress) progress.textContent = `Question ${request.index + 1} / ${request.questions.length} · ${answered}/${request.questions.length} answered`;
  const next = card.querySelector("[data-user-input-next]");
  if (next) next.disabled = !isUserInputAnswerComplete(question, request.answers.get(question.id));
}

function userInputChoice(request, question, option, { other = false } = {}) {
  const row = document.createElement("label");
  row.className = "user-input-choice";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = `user-input-${String(request.requestId)}-${question.id}`;
  if (other) {
    radio.dataset.userInputOther = "true";
    radio.value = USER_INPUT_OTHER;
  } else {
    radio.dataset.userInputOption = option.label;
    radio.value = option.label;
  }
  const answer = request.answers.get(question.id);
  radio.checked = other ? answer?.type === "text" : answer?.type === "option" && answer.value === option.label;
  const copy = document.createElement("span");
  copy.className = "user-input-choice-copy";
  const label = document.createElement("strong");
  label.textContent = other ? (question.isSecret ? "Private answer" : "Other") : option.label;
  copy.append(label);
  if (!other && option.description) {
    const description = document.createElement("span");
    description.textContent = option.description;
    copy.append(description);
  }
  row.append(radio, copy);
  return { row, radio };
}

function renderUserInputCard() {
  const request = state.userInputRequest;
  const question = currentUserInputQuestion(request);
  const existing = approvalArea.querySelector(".user-input-card");
  existing?.remove();
  if (!request || !question) {
    approvalArea.classList.remove("has-user-input");
    renderApprovalQueue();
    return;
  }

  approvalArea.classList.add("has-user-input");
  approvalArea.querySelector(".approval-card")?.remove();
  const card = document.createElement("section");
  card.className = "user-input-card";
  card.dataset.requestId = String(request.requestId);
  card.setAttribute("aria-live", "polite");

  const head = document.createElement("div");
  head.className = "user-input-card-head";
  const title = document.createElement("div");
  title.className = "user-input-card-title";
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "NEED YOUR INPUT";
  const heading = document.createElement("strong");
  heading.textContent = question.header || "Question";
  title.append(eyebrow, heading);
  const progress = document.createElement("span");
  progress.className = "user-input-progress";
  head.append(title, progress);
  card.append(head);

  const prompt = document.createElement("p");
  prompt.className = "user-input-question";
  prompt.textContent = question.question || "Please provide an answer.";
  card.append(prompt);

  const choices = document.createElement("div");
  choices.className = "user-input-choices";
  const textChoice = question.options.length && (question.isOther || question.isSecret);
  for (const option of question.options) {
    const choice = userInputChoice(request, question, option);
    choices.append(choice.row);
    choice.radio.addEventListener("change", () => {
      request.answers.set(question.id, { type: "option", value: option.label });
      if (textInput) textInput.hidden = true;
      setUserInputError(card);
      syncUserInputCard(card);
    });
  }

  let textInput = null;
  if (textChoice) {
    const choice = userInputChoice(request, question, null, { other: true });
    choices.append(choice.row);
    choice.radio.addEventListener("change", () => {
      request.answers.set(question.id, { type: "text", value: textInput?.value || "" });
      if (textInput) {
        textInput.hidden = false;
        textInput.focus();
      }
      setUserInputError(card);
      syncUserInputCard(card);
    });
  }
  if (question.options.length) card.append(choices);

  if (!question.options.length || textChoice) {
    textInput = document.createElement("input");
    textInput.type = question.isSecret ? "password" : "text";
    textInput.className = "user-input-text";
    textInput.dataset.userInputText = "true";
    textInput.placeholder = question.isSecret ? "Enter a private answer" : "Type your answer";
    textInput.autocomplete = question.isSecret ? "new-password" : "off";
    textInput.spellcheck = !question.isSecret;
    const answer = request.answers.get(question.id);
    textInput.value = answer?.type === "text" ? answer.value : "";
    textInput.hidden = Boolean(textChoice && answer?.type !== "text");
    textInput.addEventListener("input", () => {
      request.answers.set(question.id, { type: "text", value: textInput.value });
      setUserInputError(card);
      syncUserInputCard(card);
    });
    card.append(textInput);
  }

  const error = document.createElement("p");
  error.className = "user-input-error hidden";
  error.setAttribute("role", "alert");
  card.append(error);

  const actions = document.createElement("div");
  actions.className = "user-input-actions";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "secondary-button";
  previous.disabled = request.index === 0;
  previous.setAttribute("aria-label", "Previous question");
  previous.textContent = "Previous";
  const previousIcon = document.createElement("i");
  previousIcon.dataset.icon = "chevron-left";
  previous.prepend(previousIcon);
  previous.addEventListener("click", () => {
    captureUserInputAnswer(card);
    request.index -= 1;
    renderUserInputCard();
  });
  const next = document.createElement("button");
  next.type = "button";
  next.className = "user-input-submit";
  next.dataset.userInputNext = "true";
  next.textContent = request.index === request.questions.length - 1 ? "Submit" : "Next";
  const nextIcon = document.createElement("i");
  nextIcon.dataset.icon = request.index === request.questions.length - 1 ? "check" : "chevron-right";
  next.append(nextIcon);
  next.addEventListener("click", () => {
    const answer = captureUserInputAnswer(card);
    if (!isUserInputAnswerComplete(question, answer)) {
      setUserInputError(card, "Answer this question to continue.");
      syncUserInputCard(card);
      return;
    }
    if (request.index < request.questions.length - 1) {
      request.index += 1;
      renderUserInputCard();
      return;
    }
    submitUserInputRequest();
  });
  actions.append(previous, next);
  card.append(actions);
  approvalArea.append(card);
  renderIcons(card);
  syncUserInputCard(card);
  const answer = request.answers.get(question.id);
  (answer?.type === "text" ? textInput : card.querySelector("input"))?.focus();
}

function openUserInputRequest(message) {
  const questions = normalizeUserInputQuestions(message.params?.questions);
  if (!questions.length) {
    if (send({ type: "serverRequestResponse", requestId: message.id, result: { answers: {} } })) {
      addSystemMessage("Questions 0/0 answered.");
    }
    return;
  }
  clearUserInputRequest();
  const wasRunning = state.running;
  if (isNotificationForThread(message.params, state.threadId)) {
    state.activeTurnId = message.params?.turnId || state.activeTurnId;
  }
  state.running = true;
  state.threadStatus = "active";
  if (!wasRunning) setTurnActivityWorking();
  state.userInputRequest = {
    requestId: message.id,
    threadId: message.params?.threadId || state.threadId,
    turnId: message.params?.turnId || state.activeTurnId,
    questions,
    index: 0,
    answers: new Map(),
  };
  renderUserInputCard();
  updateControls();
}

function submitUserInputRequest() {
  const request = state.userInputRequest;
  if (!request) return;
  const result = buildUserInputResult(request.questions, request.answers);
  if (!result) return;
  if (!send({ type: "serverRequestResponse", requestId: request.requestId, result })) return;
  const total = request.questions.length;
  clearUserInputRequest();
  addSystemMessage(`Questions ${total}/${total} answered.`);
  updateControls();
}

function addApproval(message) {
  state.approvals = enqueueApproval(state.approvals, message);
  renderApprovalQueue();
}

function renderHistoricalBlock(block) {
  if (block.type === "message") {
    const item = block.item;
    const record = ensureMessage(item.id, block.role, {
      startedAt: item.startedAt,
      deferOutline: true,
      live: false,
      process: block.role === "assistant" && !state.historicalProcessAnswerIds.has(item.id),
      turnId: block.turnId,
    });
    record.raw = block.role === "user" ? displayInput(item.content || []) : item.text || "";
    resetStreamingMessage(record);
    renderMarkdown(record.content, record.raw, { preserveLineBreaks: block.role === "user" });
    record.renderedRaw = record.raw;
    return;
  }
  if (block.type === "commandGroup") {
    const process = ensureProcessDetails(block.turnId);
    const group = createCommandGroup(block.id, block.turnId, process.body);
    for (const entry of block.items) {
      const record = updateTool(entry.item, { live: false, process: true, container: group.items, turnId: block.turnId });
      addCommandToGroup(group, record);
    }
    for (const entry of block.items) process.itemIds.add(entry.item.id);
    updateProcessSummary(process);
    updateCommandGroupSummary(group);
    return;
  }
  if (block.type === "command") {
    updateTool(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "search") {
    updateSearchStep(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "fileChange" || block.type === "mcpTool") {
    updateTool(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "error") {
    addSystemMessage(block.item.message || block.item.error?.message || "Codex error", "error");
  } else if (block.type === "plan") {
    const item = block.item || {};
    const snapshot = {
      threadId: state.threadId,
      turnId: block.turnId,
      explanation: null,
      steps: [],
    };
    renderPlanCard(snapshot, {
      key: planSnapshotKey(state.threadId, block.turnId || item.id),
      text: item.planText || item.text || "",
      live: false,
    });
  } else if (block.type === "status") {
    const text = block.item.text || block.item.message;
    if (text) addSystemMessage(text);
  }
}

function restoreHistory(thread) {
  const cachedEntries = readThreadToolCache(thread?.id);
  state.toolCacheItems.clear();
  state.toolCacheSequence = 0;
  for (const entry of cachedEntries) {
    state.toolCacheItems.set(entry.item.id, entry);
    state.toolCacheSequence = Math.max(state.toolCacheSequence, Number(entry.sequence) + 1 || 0);
  }
  const restoredThread = mergeCachedTools(thread, cachedEntries);
  state.threadView = normalizeThread(restoredThread);
  state.latestUserInput = state.threadView.latestTurn?.items?.find((item) => item.role === "user")?.text || "";
  syncTurnActivityFromThread(thread);
  state.toolNodes.clear();
  state.processNodes.clear();
  state.historicalProcessAnswerIds.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.latestPlanKey = null;
  state.commandItems.clear();
  state.changeItems.clear();
  state.commandObservedStartMs.clear();
  state.conversationOrder = [];
  state.historicalProcessAnswerIds = new Set(buildProcessDetailsForTurns(restoredThread?.turns)
    .map((group) => group.answer?.id)
    .filter(Boolean));
  for (const block of buildConversationBlocks(restoredThread?.turns, { cwd: currentCwd() })) renderHistoricalBlock(block);
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
  if (settings.collaborationMode !== undefined) {
    populateCollaborationModes(collaborationModeValue(settings.collaborationMode));
    rememberCollaborationMode(state.threadId, settings.collaborationMode);
  }
  if (settings.cwd) cwdInput.value = settings.cwd;
  saveControlPreferences();
  updateControls();
}

function handleCodex(message) {
  const method = message.method;
  const params = message.params || {};

  if (message.id !== undefined) {
    if (method === "item/tool/requestUserInput") {
      openUserInputRequest(message);
      return;
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      addApproval(message);
      return;
    }
    addSystemMessage(`Unsupported App Server request declined: ${method}`, "warning");
    send({ type: "approval", requestId: message.id, decision: "decline" });
    return;
  }

  // Ultra can run child turns on separate threads. Their lifecycle must not
  // overwrite the active turn state shown for the selected thread.
  if (!isNotificationForThread(params, state.threadId)) return;

  switch (method) {
    case "thread/status/changed":
      if (!params.threadId || params.threadId === state.threadId) {
        const value = params.status;
        state.threadStatus = normalizeThreadStatus(value);
        state.running = state.threadStatus === "active"
          || Boolean(value?.activeFlags?.length)
          || Boolean(state.activeTurnId);
        if (state.running) setTurnActivityWorking(params.startedAt || value?.startedAt);
        else if (state.activityMode === "working") setTurnActivityWorked({ status: state.threadStatus, completedAt: params.completedAt || value?.completedAt });
        updateControls();
      }
      break;

    case "thread/tokenUsage/updated":
      if (!state.threadId || !params.threadId || params.threadId === state.threadId) {
        state.tokenUsage = params.tokenUsage || params.token_usage || null;
        state.tokenUsageThreadId = params.threadId || state.threadId;
        renderContextUsage();
      }
      break;

    case "turn/plan/updated":
      if (!params.threadId || params.threadId === state.threadId) {
        // This event is authoritative for the structured TodoList and is
        // intentionally independent from the selected collaboration mode.
        upsertPlanSnapshot(params);
      }
      break;

    case "item/plan/delta":
      if (!params.threadId || params.threadId === state.threadId) {
        const itemId = params.itemId;
        if (itemId) state.planDeltaBuffers.set(itemId, `${state.planDeltaBuffers.get(itemId) || ""}${params.delta || ""}`);
      }
      break;

    case "thread/settings/updated":
      if (!params.threadId || params.threadId === state.threadId) {
        mergeThreadSettings(params.threadSettings || params.settings || params);
        addSystemMessage("Thread settings synchronized.");
      }
      break;

    case "thread/deleted":
      handleThreadDeleted({ threadId: params.threadId });
      break;

    case "mcpServerStatus/updated":
      if (params.name) {
        state.mcpStartupStatuses[params.name] = {
          status: params.status,
          error: params.error || params.failureReason || null,
        };
      }
      break;

    case "fuzzyFileSearch/sessionUpdated":
      if (params.query !== state.mentionQuery) break;
      if (state.fileSearchSessionId && params.sessionId !== state.fileSearchSessionId) break;
      if (!state.fileSearchSearching && state.fileSearchSessionId !== params.sessionId) break;
      state.fileSearchSessionId = params.sessionId || state.fileSearchSessionId;
      state.fileSearchError = null;
      state.fileMatches = normalizeFileSearchFiles(params.files);
      renderMentionPalette();
      break;

    case "fuzzyFileSearch/sessionCompleted":
      if (!params.sessionId || params.sessionId !== state.fileSearchSessionId) break;
      state.fileSearchSearching = false;
      renderMentionPalette();
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
      state.searchActivities.clear();
      state.conversationOrder.push({ kind: "barrier", turnId: state.activeTurnId });
      setTurnActivityWorking(state.currentTurn.startedAt);
      updateControls();
      break;

    case "turn/completed": {
      clearUserInputRequest();
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
      promoteLatestAssistantAnswer(completedTurn.id || state.currentTurn?.id);
      if (status !== "completed") addSystemMessage(`Turn status: ${status}`, status === "failed" ? "error" : "warning");
      updateControls();
      refreshThreadList();
      messageInput.focus();
      drainQueue();
      break;
    }

    case "item/started": {
      const item = params.item;
      if (item && ["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) updateTool(item);
      if (item?.type === "webSearch") updateSearchStep(item, { active: true });
      startSearchActivity(item);
      break;
    }

    case "item/agentMessage/delta": {
      const id = params.itemId;
      if (!id) break;
      const record = ensureMessage(id, "assistant", {
        process: true,
        live: true,
        turnId: params.turnId || state.activeTurnId || state.currentTurn?.id,
      });
      record.streaming = true;
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
        const record = ensureMessage(item.id, "assistant", {
          process: true,
          live: true,
          turnId: item.turnId || params.turnId || state.activeTurnId || state.currentTurn?.id,
        });
        const pendingRender = state.renderTimers.get(item.id);
        if (pendingRender) {
          clearTimeout(pendingRender);
          state.renderTimers.delete(item.id);
        }
        record.raw = item.text || record.raw;
        renderCompletedMessage(record, record.raw);
      } else if (item.type === "plan") {
        const turnId = item.turnId || params.turnId || state.activeTurnId || state.currentTurn?.id;
        const key = planSnapshotKey(state.threadId, turnId);
        if (!state.planSnapshots.has(key)) {
          renderPlanCard({
            threadId: state.threadId,
            turnId,
            explanation: null,
            steps: [],
          }, {
            key,
            text: item.text || state.planDeltaBuffers.get(item.id) || "",
          });
        }
        state.planDeltaBuffers.delete(item.id);
      } else if (["commandExecution", "fileChange", "mcpToolCall"].includes(item.type)) {
        updateTool(item);
      }
      if (item.type === "webSearch") updateSearchStep(item, { active: false });
      completeSearchActivity(item);
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
  clearQueuedMessages();
  if (state.threadId && state.threadId !== payload.thread.id) {
    saveThreadUi();
    saveToolCache();
  }
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
  const storedMode = payload.thread?.id ? localStorage.getItem(collaborationModeStorageKey(payload.thread.id)) : "";
  const initialMode = payload.mode === "start"
    ? collaborationModeValue(collaborationModeSelect.value)
    : storedMode || "";
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
    collaborationMode: payload.collaborationMode || payload.thread?.collaborationMode || initialMode || null,
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
  populateCollaborationModes(collaborationModeValue(state.threadMeta.collaborationMode));
  rememberCollaborationMode(state.threadId, state.threadMeta.collaborationMode);
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
    ["Collaboration mode", currentCollaborationModeLabel()],
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
  if (state.toolCacheSaveTimer !== null) {
    clearTimeout(state.toolCacheSaveTimer);
    state.toolCacheSaveTimer = null;
  }
  if (state.commandDurationTimer) {
    clearInterval(state.commandDurationTimer);
    state.commandDurationTimer = null;
  }
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
  clearUserInputRequest();
  clearPendingRenderTimers();
  chat.replaceChildren();
  state.messageNodes.clear();
  state.toolNodes.clear();
  state.processNodes.clear();
  state.historicalProcessAnswerIds.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.latestPlanKey = null;
  state.commandObservedStartMs.clear();
  state.conversationOrder = [];
  clearQueuedMessages();
  state.toolCacheItems.clear();
  state.toolCacheSequence = 0;
  state.lastSavedToolCache = null;
  if (state.threadId) sessionStorage.removeItem(threadToolStorageKey(state.threadId));
  state.latestDiff = "";
  if (showNotice) addSystemMessage("Browser transcript cleared. Codex context was not changed.", "warning");
}

function startNewThread(sessionStartSource = null) {
  const cwd = cwdInput.value.trim();
  if (!cwd) {
    addSystemMessage("Enter a WSL project directory first.", "error");
    return;
  }
  clearUserInputRequest();
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
  clearUserInputRequest();
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

function setCollaborationMode(mode) {
  const value = String(mode || "").trim();
  if (!value) {
    addSystemMessage("No collaboration mode was advertised by App Server.", "warning");
    return false;
  }
  if (![...collaborationModeSelect.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "plan" ? "Plan" : value === "default" ? "Default" : value;
    collaborationModeSelect.append(option);
  }
  collaborationModeSelect.value = value;
  inspectorCollaborationModeSelect.value = value;
  saveControlPreferences();
  if (state.threadId) updateThreadSettings();
  updateControls();
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
    case "/delete": {
      if (!state.threadId) {
        addSystemMessage("Start or resume a thread before deleting it.", "error");
        break;
      }
      const currentThread = state.threads.find((thread) => thread.id === state.threadId) || {
        id: state.threadId,
        name: state.threadMeta.name,
        cwd: currentCwd(),
      };
      openDeleteThreadDialog(currentThread);
      break;
    }
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
        setCollaborationMode("plan");
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
  syncApprovalAreaPosition();
}

function mentionToken() {
  const before = messageInput.value.slice(0, messageInput.selectionStart);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? { query: match[1], start: before.length - match[1].length - 1, end: before.length } : null;
}

function stopActiveFileSearch() {
  const sessionId = state.fileSearchSessionId;
  state.fileSearchSessionId = null;
  state.fileSearchSearching = false;
  state.fileSearchError = null;
  if (sessionId) send({ type: "stopFileSearch", sessionId });
}

function renderMentionPalette() {
  mentionPalette.replaceChildren();
  const hasSearchState = state.fileSearchSearching || state.fileSearchError;
  if (!state.fileMatches.length && !hasSearchState) {
    mentionPalette.classList.add("hidden");
    return;
  }
  if (state.fileSearchSearching || state.fileSearchError) {
    const status = document.createElement("div");
    status.className = `mention-search-status${state.fileSearchError ? " error" : ""}`;
    status.setAttribute("role", "status");
    status.textContent = state.fileSearchError
      ? `File search failed: ${state.fileSearchError}`
      : "Searching files...";
    mentionPalette.append(status);
  }
  state.mentionIndex = state.fileMatches.length
    ? Math.min(Math.max(0, state.mentionIndex), state.fileMatches.length - 1)
    : 0;
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
    stopActiveFileSearch();
    state.mentionQuery = "";
    state.fileMatches = [];
    mentionPalette.classList.add("hidden");
    return;
  }
  clearTimeout(state.mentionTimer);
  const queryChanged = state.mentionQuery !== token.query;
  state.mentionQuery = token.query;
  if (queryChanged) {
    state.fileMatches = [];
    state.fileSearchSessionId = null;
    state.fileSearchSearching = Boolean(token.query);
    state.fileSearchError = null;
    renderMentionPalette();
  }
  state.mentionTimer = setTimeout(() => {
    if (!state.mentionQuery) {
      state.fileMatches = [];
      state.fileSearchSearching = false;
      renderMentionPalette();
      return;
    }
    if (!send({ type: "searchFiles", query: state.mentionQuery, cwd: currentCwd() })) {
      state.fileSearchSearching = false;
      state.fileSearchError = "WebSocket is not connected.";
      renderMentionPalette();
    }
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
  stopActiveFileSearch();
  state.mentionQuery = "";
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
  const text = messageInput.value;
  const trimmedText = text.trim();
  if (!trimmedText && !state.mentions.length && !state.images.length) return;
  if (trimmedText.startsWith("/") && !state.mentions.length && !state.images.length) {
    messageInput.value = "";
    autoSizeComposer();
    slashPalette.classList.add("hidden");
    executeSlash(trimmedText);
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
  clearComposerInput();
  if (state.running || queueDispatchActive()) {
    // Enter while a turn is active is a follow-up queue operation. It does
    // not create a chat bubble until App Server accepts the next turn.
    enqueueFollowUp(input);
    return;
  }
  sendComposedMessage(input, selectedSettings());
}

function sendComposedMessage(input, settings) {
  if (queueDispatchActive()) {
    enqueueFollowUp(input);
    return;
  }
  addLocalUserMessage(input);
  state.latestUserInput = displayInput(input);
  const requestId = queueRequestId();
  state.running = true;
  state.threadStatus = "active";
  setTurnActivityWorking();
  updateControls();
  if (!send({
    type: "sendMessage",
    requestId,
    threadId: state.threadId,
    clientUserMessageId: requestId,
    input,
    ...(settings || selectedSettings()),
  })) {
    state.running = false;
    state.threadStatus = "idle";
    clearTurnActivity();
    updateControls();
  }
}

function composeCurrentInput() {
  const text = messageInput.value;
  if (!text.trim() && !state.mentions.length && !state.images.length) return null;
  try {
    return composeUserInput(text, state.mentions, state.images);
  } catch (error) {
    addSystemMessage(error.message, "error");
    return null;
  }
}

function submitSteerNow() {
  const input = composeCurrentInput();
  if (!input) return;
  clearComposerInput();
  steerCurrentTurn(input);
}

function submitFollowUp() {
  const input = composeCurrentInput();
  if (!input) return;
  clearComposerInput();
  enqueueFollowUp(input);
}

socket.addEventListener("open", () => setConnection("Bridge connected", true));
socket.addEventListener("close", () => {
  state.ready = false;
  state.running = false;
  releaseQueueDispatch({ fail: true, error: "WebSocket disconnected." });
  clearUserInputRequest();
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
      state.collaborationModes = payload.collaborationModes || [];
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
      state.collaborationModes = payload.collaborationModes || state.collaborationModes;
      state.metadataErrors = payload.metadataErrors || state.metadataErrors;
      populateModels(currentModelLabel());
      updateControls();
      break;

    case "threadReady":
      clearUserInputRequest();
      applyThreadResponse(payload);
      clearPendingRenderTimers();
      chat.replaceChildren();
      approvalArea.replaceChildren();
      state.outlineObserver?.disconnect();
      state.messageNodes.clear();
      state.toolNodes.clear();
      state.processNodes.clear();
      state.historicalProcessAnswerIds.clear();
      state.searchNodes.clear();
      state.planSnapshots.clear();
      state.planNodes.clear();
      state.planDeltaBuffers.clear();
      state.latestPlanKey = null;
      state.commandItems.clear();
      state.changeItems.clear();
      state.commandObservedStartMs.clear();
      state.conversationOrder = [];
      state.toolCacheItems.clear();
      state.toolCacheSequence = 0;
      state.lastSavedToolCache = null;
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
      if (consumeIgnoredQueueResponse(payload.requestId)) break;
      {
        const dispatch = state.queueDispatch?.requestId === payload.requestId ? state.queueDispatch : null;
        const queuedId = state.queueRequestIds.get(payload.requestId) || dispatch?.entryId;
        if (dispatch) state.queueDispatch = null;
        if (payload.accepted === false) {
          if (queuedId) {
            state.queueRequestIds.delete(payload.requestId);
            failQueueEntry(queuedId, payload.error?.message || "Turn was not accepted");
          }
          state.running = false;
          state.threadStatus = "idle";
          state.activeTurnId = null;
          clearTurnActivity();
          addSystemMessage(payload.error?.message || "Turn was not accepted.", "error");
          updateControls();
          break;
        }
        if (queuedId) {
          const queued = currentQueueEntries().find((entry) => entry.id === queuedId);
          state.queueRequestIds.delete(payload.requestId);
          if (queued) {
            addLocalUserMessage(queued.input);
            state.latestUserInput = queued.displayText;
          }
          updateQueue({ type: "accepted", id: queuedId, requestId: payload.requestId });
          updateQueue({ type: "remove", id: queuedId });
        }
        state.activeTurnId = payload.turn?.id || state.activeTurnId;
        state.running = true;
        state.threadStatus = "active";
        setTurnActivityWorking(payload.turn?.startedAt);
        updateControls();
      }
      break;

    case "steerAccepted":
      if (payload.accepted === false) {
        state.steerRequestInputs.delete(payload.requestId);
        addSystemMessage(payload.error?.message || "Steer was not accepted.", "error");
        break;
      }
      {
        const input = state.steerRequestInputs.get(payload.requestId);
        state.steerRequestInputs.delete(payload.requestId);
        if (input) {
          addLocalUserMessage(input);
          state.latestUserInput = displayInput(input);
        }
      }
      state.running = true;
      state.threadStatus = "active";
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

    case "threadArchived": {
      clearUserInputRequest();
      clearQueuedMessages();
      if (state.threadId) localStorage.removeItem(collaborationModeStorageKey(state.threadId));
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
      addSystemMessage("Thread archived.");
      refreshThreadList();
      updateControls();
      break;
    }

    case "threadDeleted":
      handleThreadDeleted(payload);
      break;

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
        state.fileSearchSessionId = payload.sessionId || state.fileSearchSessionId;
        state.fileSearchSearching = false;
        state.fileSearchError = null;
        state.fileMatches = normalizeFileSearchFiles(payload.result);
        state.mentionIndex = 0;
        renderMentionPalette();
      }
      break;

    case "fileSearchStarted":
      if (payload.query === state.mentionQuery) {
        state.fileSearchSessionId = payload.sessionId || null;
        state.fileSearchSearching = true;
        state.fileSearchError = null;
        renderMentionPalette();
      }
      break;

    case "fileSearchError":
      if (payload.query === state.mentionQuery
        && (!state.fileSearchSessionId || !payload.sessionId || payload.sessionId === state.fileSearchSessionId)) {
        state.fileSearchSessionId = payload.sessionId || state.fileSearchSessionId;
        state.fileSearchSearching = false;
        state.fileSearchError = payload.error?.message || "Unknown file search error.";
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
      if (payload.requestId) {
        removePendingThreadDelete(payload.requestId);
        renderThreadList();
        if (state.queueDispatch?.requestId === payload.requestId || state.queueRequestIds.has(payload.requestId)) {
          releaseQueueDispatch({ fail: true, error: payload.message || "Queue request failed." });
        }
      }
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
collaborationModeSelect.addEventListener("change", () => {
  inspectorCollaborationModeSelect.value = collaborationModeSelect.value;
  updateThreadSettings();
  updateControls();
});
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
inspectorCollaborationModeSelect.addEventListener("change", () => {
  collaborationModeSelect.value = inspectorCollaborationModeSelect.value;
  updateThreadSettings();
  updateControls();
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
steerButton.addEventListener("click", submitSteerNow);
followUpButton.addEventListener("click", submitFollowUp);
function interruptActiveTurn() {
  if (!state.running || !state.activeTurnId) return;
  if (send({ type: "interrupt", turnId: state.activeTurnId })) {
    clearUserInputRequest();
    updateControls();
  }
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
      stopActiveFileSearch();
      mentionPalette.classList.add("hidden");
      return;
    }
  }
  if (!mentionPalette.classList.contains("hidden")
    && !state.fileMatches.length
    && (state.fileSearchSearching || state.fileSearchError)
    && event.key === "Escape") {
    event.preventDefault();
    stopActiveFileSearch();
    mentionPalette.classList.add("hidden");
    return;
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
window.addEventListener("pagehide", () => {
  saveThreadUi();
  saveToolCache();
});

workspaceButton.addEventListener("click", () => {
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
deleteThreadDialog.addEventListener("close", () => {
  state.deleteDialogThread = null;
  state.deleteDialogThreadId = null;
});
confirmDeleteThreadButton.addEventListener("click", (event) => {
  event.preventDefault();
  const threadId = state.deleteDialogThreadId;
  deleteThreadDialog.close();
  if (threadId) requestDeleteThread(threadId);
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
  renderContextUsage();
  syncApprovalAreaPosition();
});

if (composer && typeof ResizeObserver === "function") {
  new ResizeObserver(syncApprovalAreaPosition).observe(composer);
}

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
