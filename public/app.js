import DOMPurify from "/vendor/dompurify/dist/purify.es.mjs";
import katex from "/vendor/katex/dist/katex.mjs";
import { marked } from "/vendor/marked/lib/marked.esm.js";
import { createMathRenderCache, extractMath, findStableMarkdownBoundary, renderMathSlots, scheduleMathSlots } from "/math-renderer.js";
import { bridgeClient } from "/bridge-client.js";
import { createKeyedFrameScheduler, scheduleIdleTask, scheduleTimeSliced } from "/render-scheduler.js";
import { guardianEventFromNotification, prioritizeSlashMatches, resolveSlashSelection } from "/slash-input.js";
import { slashAliases, slashCommands } from "/slash-commands.js";
import { currentApproval, enqueueApproval, removeApproval as removeQueuedApproval } from "/approval-data.js";
import { codexVersion, formatCompactNumber, providerStatus, threadTokenStats, unwrapConfig } from "/status-data.js";
import { formatMcpInventory, normalizeMcpInventory } from "/mcp-data.js";
import { compactThreadCwd, filterThreads, formatThreadTime, groupThreads, mergeThreadPages, threadTitle } from "/thread-list-data.js";
import { removeThreadById, removeThreadFromNavigation } from "/thread-delete-data.js";
import { composeUserInput, displayInput, makeMention, MAX_IMAGES, presentUserInput, validateImage } from "/composer-input.js";
import { diffRowMarker, normalizeFileChanges, visibleDiffRows } from "/diff-data.js";
import { normalizeFileSearchFiles } from "/file-search-data.js";
import {
  browserFileName,
  browserParentPath,
  closeBrowserFileTab,
  formatBrowserFileSize,
  isBrowserImagePath,
  normalizeBrowserFilePath,
  openBrowserFileTab,
  resolveWorkspaceFileHref,
  sourceFileLines,
  toggleRightPanelMode,
} from "/file-browser-data.js";
import { countOutputLines, normalizeToolStatus, presentAgentActivity, presentCommand, searchActivityLabel, summarizeProcessActivities, tailOutputLines, toolInputPreview } from "/command-presentation.js";
import { buildConversationBlocks, buildProcessDetailsForTurns, mergeCachedTools } from "/conversation-blocks.js";
import { buildProcessDetails, isDisplayableProcessItem, isToolCallItem, normalizeDisplayStatus, presentTool, resolveModelDisplayName } from "/message-display.js";
import { createQueueEntry, isQueueEntryRetryable, nextQueueEntry, queueForThread, queueReducer } from "/queue-data.js";
import { normalizeThread } from "/thread-items.js";
import { isNotificationForThread } from "/notification-scope.js";
import {
  applyRuntimeSnapshot,
  canBeginThreadSelection,
  createThreadRuntimeStore,
  getThreadRuntime,
  isThreadRuntimeBusy,
  markThreadRuntimeRead,
  readSelectedThread,
  runtimeIndicator,
  runtimeThreadIdFromNotification,
  selectThreadRuntime,
  updateThreadRuntime,
  writeSelectedThread,
} from "/thread-runtime-state.js";
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
import {
  buildCollaborationModePayload,
  createSessionSettings,
  navigateThread,
  pushThreadNavigation,
  retireSettingsRequest,
  resolveReasoningEffort,
  shouldApplySettingsResponse,
  shouldFollowScroll,
} from "/session-state.js";
import { formatActivityDuration, isActiveTurnStatus, resolveTurnDurationMs, timestampToMs } from "/turn-activity.js";
import { enhanceMarkdownCodeBlocks } from "/markdown-code-blocks.js";
import { accessControlState, snapshotBannerText as formatSnapshotBannerText } from "/access-presentation.js";
import { reasoningText } from "/protocol-text.js";
import {
  createProtocolState,
  getProtocolItem,
  reduceProtocolState,
  toProtocolSnapshot,
} from "/protocol-state.js";
import { renderIcons } from "/icons.js";
import {
  activeConversationTurnIndex,
  conversationPreviewText,
  layoutConversationMinimap,
  nearestConversationMinimapIndex,
} from "/conversation-minimap.js";

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
const sessionSummary = $("#sessionSummary");
const directorySummary = $("#directorySummary");
const runStatus = $("#runStatus");
const contextSummary = $("#contextSummary");
const snapshotBanner = $("#snapshotBanner");
const snapshotBannerText = $("#snapshotBannerText");
const refreshSnapshotButton = $("#refreshSnapshotButton");
const conversationView = $("#conversationView");
const chat = $("#chat");
const chatEmptyState = $("#chatEmptyState");
const chatMinimap = $("#chatMinimap");
const chatMinimapRail = $("#chatMinimapRail");
const chatMinimapLine = $("#chatMinimapLine");
const conversationOutline = $("#conversationOutline");
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
const rightPanel = $("#rightPanel");
const rightPanelResizeHandle = $("#rightPanelResizeHandle");
const filePanelButton = $("#filePanelButton");
const filePanel = $("#filePanel");
const fileTabs = $("#fileTabs");
const fileViewer = $("#fileViewer");
const explorerShell = $("#explorerShell");
const explorerTree = $("#explorerTree");
const explorerToggleButton = $("#explorerToggleButton");
const refreshExplorerButton = $("#refreshExplorerButton");
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
const mathRenderCache = createMathRenderCache();
const bridge = globalThis.codexBridge || globalThis.codexWebBridge || bridgeClient;

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
  selectedThreadId: null,
  selectionPending: false,
  threadRuntimes: createThreadRuntimeStore(),
  reconnecting: false,
  accessMode: null,
  snapshotAt: null,
  snapshotReason: null,
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
  activityNodes: new Map(),
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
  pendingSettingsThreadId: null,
  settingsRequestSequence: 0,
  latestSettingsRequests: new Map(),
  activeView: "conversation",
  threadView: normalizeThread({}),
  commandItems: new Map(),
  changeItems: new Map(),
  searchNodes: new Map(),
  commandObservedStartMs: new Map(),
  conversationOrder: [],
  processEpochs: new Map(),
  conversationNodeMeta: new Map(),
  conversationNodeOrdinal: 0,
  conversationFallbackAnchor: null,
  conversationFallbackIndex: 0,
  historyOrderRanks: new Map(),
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
  expandedMcpTools: new Set(),
  expandedCommandOutputs: new Set(),
  expandedProcesses: new Set(),
  queueEntries: [],
  queueRequestIds: new Map(),
  queueDispatch: null,
  ignoredQueueRequestIds: new Set(),
  steerRequestInputs: new Map(),
  steerRequestThreads: new Map(),
  historicalProcessAnswerIds: new Set(),
  protocolState: createProtocolState(),
  pendingServerRequests: new Map(),
  outlineNodes: new Map(),
  outlineTurns: [],
  outlineLayout: null,
  outlineRenderTimer: null,
  outlinePreviewHideTimer: null,
  outlineActiveLock: null,
  locatedOutlineMessageId: null,
  activeOutlineNode: null,
  activeOutlineMessageId: null,
  fileAccessToken: null,
  defaultCwd: null,
  fileWorkspaceCwd: null,
  rightPanelMode: "closed",
  fileTabs: [],
  activeFilePath: null,
  fileViewData: new Map(),
  fileViewModes: new Map(),
  fileViewRequest: 0,
  explorerRequestGeneration: 0,
  explorerRefreshTimer: null,
  explorerIdleCancel: null,
  explorerChildren: new Map(),
  explorerExpanded: new Set(),
  explorerLoading: new Set(),
  explorerErrors: new Map(),
  historyRestoreGeneration: 0,
  historyRestoreJob: null,
  historyRestoring: false,
  historyLatestScrollPending: false,
  historyRestoreScrollBaseline: null,
  historyRestoreScrollInterrupted: false,
  historySwitchTargetId: null,
  conversationReconcilePending: false,
  historyObserverMuted: false,
  historyObserverReleaseTimer: null,
  threadListStructureKey: "",
  threadRowNodes: new Map(),
};

const historyCancelSendHook = Symbol.for("codex.historyCancelSendHook");
if (typeof bridge.send === "function" && !bridge[historyCancelSendHook]) {
  const bridgeSend = bridge.send.bind(bridge);
  bridge.send = (payload) => {
    if (payload?.type !== "resumeThread") return bridgeSend(payload);
    state.historySwitchTargetId = String(payload.threadId || "").trim() || null;
    cancelHistoryRestore();
    const sent = bridgeSend(payload);
    if (!sent) state.historySwitchTargetId = null;
    return sent;
  };
  bridge[historyCancelSendHook] = true;
}

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

let socket = bridge;

function send(payload) {
  if (!socket || socket.readyState !== 1) {
    addSystemMessage("WebSocket is not connected.", "error");
    return false;
  }
  try {
    return socket.send(payload) !== false;
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

function selectedRuntime() {
  return getThreadRuntime(state.threadRuntimes, state.threadId, false);
}

function settingsRequestFor(threadId = state.threadId) {
  const id = String(threadId || "").trim();
  return id ? state.latestSettingsRequests.get(id) || null : null;
}

function settingsResponseIsCurrent(threadId, response, responseRevision = null) {
  const latest = settingsRequestFor(threadId);
  if (!latest) return true;
  return shouldApplySettingsResponse({
    response,
    expected: latest.settings,
    responseRevision,
    latestRevision: latest.revision,
  });
}

function persistSelectedThread(threadId) {
  state.selectedThreadId = threadId || null;
  writeSelectedThread(sessionStorage, state.selectedThreadId);
}

function captureSelectedRuntime() {
  if (!state.threadId) return null;
  return updateThreadRuntime(state.threadRuntimes, state.threadId, {
    activeTurnId: state.activeTurnId,
    status: state.threadStatus,
    running: state.running,
    accessMode: state.accessMode,
    snapshotAt: state.snapshotAt,
    snapshotReason: state.snapshotReason,
    latestThread: state.threadView,
    pendingServerRequests: [...state.pendingServerRequests.entries()].map(([id, request]) => ({ id, ...request })),
    pendingTurnSettings: selectedRuntime()?.pendingTurnSettings || {},
    unread: false,
  }, { markUnread: false });
}

function syncRuntimeFromCurrentState() {
  const runtime = selectedRuntime();
  if (!runtime) return;
  runtime.activeTurnId = state.activeTurnId;
  runtime.status = state.threadStatus;
  runtime.running = state.running;
  runtime.accessMode = state.accessMode;
  runtime.snapshotAt = state.snapshotAt;
  runtime.snapshotReason = state.snapshotReason;
  runtime.latestThread = state.threadView;
  runtime.pendingServerRequests = [...state.pendingServerRequests.entries()].map(([id, request]) => ({ id, ...request }));
}

function runtimeNotificationPatch(message) {
  const params = message?.params || {};
  const method = String(message?.method || "");
  const patch = {
    lastEventAt: new Date().toISOString(),
    latestNotification: { method, params },
  };
  if (method === "turn/started") {
    patch.running = true;
    patch.status = "active";
    patch.activeTurnId = params.turn?.id || params.turnId || null;
  } else if (method === "turn/completed") {
    patch.running = false;
    patch.status = params.turn?.status || "idle";
    patch.activeTurnId = null;
    patch.latestTurn = params.turn || null;
  } else if (method === "thread/status/changed") {
    patch.status = params.status || "unknown";
    patch.running = params.status === "active" || Boolean(params.activeTurnId);
    patch.activeTurnId = params.activeTurnId || null;
  } else if (method === "thread/tokenUsage/updated") {
    patch.tokenUsage = params.tokenUsage || params.token_usage || null;
  } else if (method === "thread/archived" || method === "thread/closed") {
    patch.running = false;
    patch.status = method === "thread/archived" ? "archived" : "closed";
    patch.activeTurnId = null;
  }
  return patch;
}

function rememberRuntimeNotification(message) {
  const threadId = runtimeThreadIdFromNotification(message);
  if (!threadId) return null;
  const runtime = updateThreadRuntime(state.threadRuntimes, threadId, runtimeNotificationPatch(message));
  if (message.method === "serverRequest/resolved") {
    const requestId = String(message.params?.requestId ?? "");
    runtime.pendingServerRequests = (runtime.pendingServerRequests || [])
      .filter((request) => String(request.id) !== requestId);
  }
  const notification = runtime.latestNotification;
  runtime.pendingNotifications = [...(runtime.pendingNotifications || []), notification].slice(-120);
  renderThreadList();
  return runtime;
}

function rememberPendingRuntimeRequest(message, threadId) {
  if (!threadId || message?.id === undefined) return null;
  const runtime = getThreadRuntime(state.threadRuntimes, threadId);
  const entry = {
    id: String(message.id),
    method: message.method,
    threadId,
    turnId: message.params?.turnId || runtime.activeTurnId || null,
    message,
  };
  const pending = [...(runtime.pendingServerRequests || []).filter((item) => String(item.id) !== entry.id), entry];
  const next = updateThreadRuntime(state.threadRuntimes, threadId, {
    pendingServerRequests: pending,
    running: runtime.running,
    status: runtime.status,
  });
  renderThreadList();
  return next;
}

function applyRuntimeMessage(payload) {
  const changed = applyRuntimeSnapshot(state.threadRuntimes, payload);
  if (payload.deleted) {
    renderThreadList();
    return [];
  }
  if (payload.selectedThreadId) {
    state.selectedThreadId = payload.selectedThreadId;
  }
  let staleUserInput = false;
  for (const runtime of changed) {
    if (runtime.threadId === state.selectedThreadId || runtime.threadId === state.threadId) markThreadRuntimeRead(state.threadRuntimes, runtime.threadId);
    if (runtime.threadId === state.threadId && Array.isArray(runtime.pendingServerRequests)) {
      const pendingIds = new Set(runtime.pendingServerRequests.map((request) => String(request.id ?? request.requestId)));
      for (const [requestId, request] of state.pendingServerRequests) {
        if (request.threadId === runtime.threadId && !pendingIds.has(String(requestId))) {
          state.pendingServerRequests.delete(requestId);
          state.approvals = removeQueuedApproval(state.approvals, requestId);
          if (state.userInputRequest?.requestId !== undefined && String(state.userInputRequest.requestId) === String(requestId)) {
            staleUserInput = true;
          }
        }
      }
    }
  }
  if (staleUserInput) clearUserInputRequest();
  if (changed.length) {
    const runtime = selectedRuntime();
    if (runtime && runtime.latestThread && runtime.threadId === state.threadId) {
      state.running = runtime.running;
      state.activeTurnId = runtime.activeTurnId;
      state.threadStatus = runtime.status;
    }
    const usage = runtime?.tokenUsage || runtime?.latestEvent?.params?.tokenUsage || runtime?.latestEvent?.params?.token_usage;
    if (runtime?.threadId === state.threadId && usage) {
      state.tokenUsage = usage;
      state.tokenUsageThreadId = runtime.threadId;
      renderContextUsage();
    }
    renderThreadList();
    updateControls();
  }
  return changed;
}

function restorePendingRuntimeRequests(runtime) {
  for (const request of runtime?.pendingServerRequests || []) {
    const message = request.message || request;
    if (message?.id === undefined || !message.method) continue;
    state.pendingServerRequests.set(String(message.id), {
      method: message.method,
      threadId: message.params?.threadId || runtime.threadId,
      turnId: message.params?.turnId || runtime.activeTurnId,
      message,
    });
    if (message.method === "item/tool/requestUserInput") openUserInputRequest(message);
    else if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") addApproval(message);
  }
}

function prepareThreadSelection(threadId) {
  const id = String(threadId || "").trim();
  if (!id || id === state.threadId) return;
  const previousId = state.threadId;
  captureSelectedRuntime();
  if (previousId) {
    saveThreadUi();
    saveToolCache();
  }
  state.threadId = id;
  state.selectedThreadId = id;
  state.selectionPending = true;
  const runtime = selectThreadRuntime(state.threadRuntimes, id, { markRead: true });
  state.activeTurnId = runtime?.activeTurnId || null;
  state.running = Boolean(runtime?.running);
  state.threadStatus = runtime?.status || "notLoaded";
  state.accessMode = runtime?.accessMode || null;
  state.snapshotAt = runtime?.snapshotAt || null;
  state.snapshotReason = runtime?.snapshotReason || null;
  state.threadMeta = {};
  state.threadView = normalizeThread({});
  clearPendingRenderTimers();
  chat.replaceChildren(chatEmptyState);
  state.messageNodes.clear();
  state.toolNodes.clear();
  state.activityNodes.clear();
  state.processNodes.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.protocolState = createProtocolState();
  state.approvals = [];
  state.pendingServerRequests.clear();
  clearTurnActivity();
  persistSelectedThread(id);
  renderConversationOutline();
  renderThreadList();
  updateControls();
}

function prepareNewThreadSelection() {
  captureSelectedRuntime();
  if (state.threadId) {
    saveThreadUi();
    saveToolCache();
  }
  state.threadId = null;
  state.selectedThreadId = null;
  state.selectionPending = true;
  state.activeTurnId = null;
  state.running = false;
  state.threadStatus = "notLoaded";
  state.threadMeta = {};
  state.threadView = normalizeThread({});
  clearPendingRenderTimers();
  chat.replaceChildren(chatEmptyState);
  state.messageNodes.clear();
  state.toolNodes.clear();
  state.activityNodes.clear();
  state.processNodes.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.protocolState = createProtocolState();
  state.approvals = [];
  state.pendingServerRequests.clear();
  clearTurnActivity();
  persistSelectedThread(null);
  renderConversationOutline();
  renderThreadList();
  updateControls();
}

function payloadThreadId(payload) {
  return String(payload?.threadId || payload?.thread?.id || payload?.turn?.threadId || payload?.result?.thread?.id || "").trim() || null;
}

function canonicalThreadSnapshot(payload) {
  const source = payload?.thread && typeof payload.thread === "object" ? payload.thread : {};
  const turns = Array.isArray(payload?.turns)
    ? payload.turns
    : Array.isArray(source.turns)
      ? source.turns
      : null;
  if (!turns) return source;
  return { ...source, turns };
}

function canonicalizeThreadReadyPayload(payload) {
  if (payload?.type !== "threadReady") return payload;
  const hasThread = payload.thread && typeof payload.thread === "object";
  const hasTurns = Array.isArray(payload.turns) || Array.isArray(payload.thread?.turns);
  if (!hasThread && !hasTurns) return payload;
  return { ...payload, thread: canonicalThreadSnapshot(payload) };
}

function handleBackgroundBridgePayload(payload, threadId) {
  const runtime = getThreadRuntime(state.threadRuntimes, threadId);
  const patch = { lastEventAt: new Date().toISOString() };
  patch.latestBridgeResponse = payload;
  if (["turnAccepted", "reviewAccepted"].includes(payload.type)) {
    patch.running = payload.accepted === false ? false : true;
    patch.status = patch.running ? "active" : "idle";
    patch.activeTurnId = payload.accepted === false ? null : payload.turn?.id || runtime.activeTurnId;
  } else if (payload.type === "steerAccepted") {
    patch.running = payload.accepted !== false;
    patch.status = patch.running ? "active" : "idle";
    patch.activeTurnId = payload.turn?.id || runtime.activeTurnId;
  } else if (payload.type === "threadReady") {
    patch.latestThread = payload.thread || runtime.latestThread || null;
    patch.latestSnapshot = payload;
    patch.accessMode = payload.accessMode || runtime.accessMode;
    patch.snapshotAt = payload.snapshotAt || null;
    patch.snapshotReason = payload.snapshotReason || null;
    patch.error = null;
  } else if (payload.type === "settingsUpdateAccepted") {
    const requested = payload.requested && typeof payload.requested === "object" ? payload.requested : {};
    if (!settingsResponseIsCurrent(threadId, requested, payload.settingsRevision)) return;
    retireSettingsRequest(state.latestSettingsRequests, threadId, requested, payload.settingsRevision);
    patch.latestSettings = requested;
    patch.pendingTurnSettings = payload.mode === "thread"
      ? {}
      : { ...(runtime.pendingTurnSettings || {}), ...requested };
  } else if (payload.type === "threadRenamed") {
    const name = payload.name ?? payload.threadName ?? "";
    patch.name = name;
    patch.latestThread = { ...(runtime.latestThread || {}), name };
    const index = state.threads.findIndex((thread) => thread.id === threadId);
    if (index >= 0) state.threads[index] = { ...state.threads[index], name };
  } else if (payload.type === "serverRequestsExpired") {
    const expired = new Set((payload.requestIds || []).map((requestId) => String(requestId)));
    patch.pendingServerRequests = (runtime.pendingServerRequests || [])
      .filter((request) => !expired.has(String(request.id ?? request.requestId)));
    patch.error = { message: payload.message || "Pending Codex requests expired.", details: null };
  } else if (payload.type === "mcpResult") {
    patch.latestMcpResult = payload.result;
  } else if (payload.type === "threadArchived") {
    patch.running = false;
    patch.status = "archived";
    patch.activeTurnId = null;
  } else if (payload.type === "bridgeError") {
    patch.error = { message: payload.message, details: payload.details || null };
    const targetDispatch = state.queueDispatch?.threadId === threadId
      && state.queueDispatch?.requestId === payload.requestId
      ? state.queueDispatch
      : null;
    const mappedEntryId = state.queueRequestIds.get(payload.requestId);
    const targetEntry = state.queueEntries.find((entry) => entry.threadId === threadId
      && (entry.id === mappedEntryId || entry.requestId === payload.requestId));
    if (payload.requestId && (targetEntry || targetDispatch)) {
      const entryId = targetEntry?.id || targetDispatch?.entryId;
      failQueueEntry(entryId, payload.message || "Queue request failed.");
      state.queueRequestIds.delete(payload.requestId);
      if (targetDispatch) state.queueDispatch = null;
    }
  }
  updateThreadRuntime(state.threadRuntimes, threadId, patch);

  if (["turnAccepted", "steerAccepted"].includes(payload.type) && payload.requestId) {
    if (payload.type === "steerAccepted" && state.steerRequestThreads.get(payload.requestId) === threadId) {
      state.steerRequestInputs.delete(payload.requestId);
      state.steerRequestThreads.delete(payload.requestId);
    }
    const dispatch = state.queueDispatch?.threadId === threadId
      && state.queueDispatch?.requestId === payload.requestId
      ? state.queueDispatch
      : null;
    const mappedEntryId = state.queueRequestIds.get(payload.requestId);
    const targetEntry = state.queueEntries.find((entry) => entry.threadId === threadId
      && (entry.id === mappedEntryId || entry.requestId === payload.requestId));
    const queuedId = targetEntry?.id || dispatch?.entryId;
    if (queuedId) state.queueRequestIds.delete(payload.requestId);
    if (dispatch) state.queueDispatch = null;
    if (queuedId) {
      if (payload.accepted === false) failQueueEntry(queuedId, payload.error?.message || "Turn was not accepted");
      else {
        updateQueue({ type: "accepted", id: queuedId, requestId: payload.requestId });
        updateQueue({ type: "remove", id: queuedId });
      }
    }
  }
  renderThreadList();
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
  return buildCollaborationModePayload({
    value: mode,
    preset,
    model: modelSelect.value,
    effort: displayEffortLabel(),
  });
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

function iconElement(name, className = "") {
  const icon = document.createElement("i");
  icon.dataset.icon = name;
  if (className) icon.className = className;
  return icon;
}

function workspaceAbsolutePath(relativePath) {
  const cwd = String(state.fileWorkspaceCwd || currentCwd() || "").replace(/[\\/]+$/, "");
  const path = normalizeBrowserFilePath(relativePath);
  if (!cwd || path === null) return path || "";
  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd}${separator}${path.replaceAll("/", separator)}`;
}

function revokeFileViewData(data) {
  if (data?.kind === "image" && data.url) URL.revokeObjectURL(data.url);
}

function clearFileViewCache() {
  for (const data of state.fileViewData.values()) revokeFileViewData(data);
  state.fileViewData.clear();
  state.fileViewModes.clear();
  state.fileViewRequest += 1;
}

function setRightPanelMode(mode, { persist = true } = {}) {
  const nextMode = ["files", "inspector"].includes(mode) ? mode : "closed";
  state.rightPanelMode = nextMode;
  rightPanel.dataset.mode = nextMode;
  rightPanel.classList.toggle("closed", nextMode === "closed");
  filePanelButton.classList.toggle("active", nextMode === "files");
  filePanelButton.setAttribute("aria-expanded", String(nextMode === "files"));
  filePanelButton.setAttribute("aria-label", nextMode === "files" ? "Hide file panel" : "Show file panel");
  filePanelButton.title = filePanelButton.getAttribute("aria-label");
  const inspectorButton = $("#inspectorButton");
  inspectorButton.classList.toggle("active", nextMode === "inspector");
  inspectorButton.setAttribute("aria-expanded", String(nextMode === "inspector"));
  if (persist) {
    localStorage.setItem("codexRightPanelMode", nextMode);
    localStorage.setItem("codexInspectorOpen", String(nextMode === "inspector"));
  }
  updateBackdrop();
  if (nextMode === "files") {
    renderFileTabs();
    renderFileViewer();
  } else if (nextMode === "inspector") {
    state.mcpDialogRequested = false;
    send({ type: "listMcp", threadId: state.threadId, verbose: false });
  }
  requestAnimationFrame(measureConversationMinimap);
}

function toggleFilePanel(force) {
  const mode = force === true
    ? "files"
    : force === false
      ? "closed"
      : toggleRightPanelMode(state.rightPanelMode, "files");
  setRightPanelMode(mode);
}

function setFilePanelWidth(value, { persist = false } = {}) {
  const width = Math.min(640, Math.max(360, Math.round(Number(value) || 480)));
  document.documentElement.style.setProperty("--file-panel-width", `${width}px`);
  rightPanelResizeHandle.setAttribute("aria-valuemin", "360");
  rightPanelResizeHandle.setAttribute("aria-valuemax", "640");
  rightPanelResizeHandle.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem("codexFilePanelWidth", String(width));
  return width;
}

function beginFilePanelResize(event) {
  if (state.rightPanelMode !== "files" || window.innerWidth < 1360) return;
  event.preventDefault();
  rightPanel.classList.add("resizing");
  rightPanelResizeHandle.setPointerCapture?.(event.pointerId);
  const move = (moveEvent) => setFilePanelWidth(window.innerWidth - moveEvent.clientX);
  const finish = () => {
    rightPanel.classList.remove("resizing");
    rightPanelResizeHandle.removeEventListener("pointermove", move);
    rightPanelResizeHandle.removeEventListener("pointerup", finish);
    rightPanelResizeHandle.removeEventListener("pointercancel", finish);
    setFilePanelWidth(rightPanelResizeHandle.getAttribute("aria-valuenow"), { persist: true });
  };
  rightPanelResizeHandle.addEventListener("pointermove", move);
  rightPanelResizeHandle.addEventListener("pointerup", finish);
  rightPanelResizeHandle.addEventListener("pointercancel", finish);
}

function resetFileWorkspace(cwd, { keepPanel = true, force = false } = {}) {
  const nextCwd = String(cwd || "").replace(/[\\/]+$/, "");
  if (!force && nextCwd === state.fileWorkspaceCwd && state.explorerChildren.size) return;
  state.fileWorkspaceCwd = nextCwd;
  state.explorerRequestGeneration += 1;
  if (state.explorerIdleCancel) {
    state.explorerIdleCancel();
    state.explorerIdleCancel = null;
  }
  if (state.explorerRefreshTimer) {
    clearTimeout(state.explorerRefreshTimer);
    state.explorerRefreshTimer = null;
  }
  clearFileViewCache();
  state.fileTabs = [];
  state.activeFilePath = null;
  state.explorerChildren.clear();
  state.explorerExpanded.clear();
  state.explorerLoading.clear();
  state.explorerErrors.clear();
  renderFileTabs();
  renderFileViewer();
  renderExplorerTree();
  if (!keepPanel && state.rightPanelMode === "files") setRightPanelMode("closed");
  if (state.fileAccessToken && nextCwd) {
    const generation = state.explorerRequestGeneration;
    state.explorerIdleCancel = scheduleIdleTask(() => {
      state.explorerIdleCancel = null;
      if (generation !== state.explorerRequestGeneration) return;
      loadExplorerDirectory("");
    }, { timeout: 180 });
  }
}

async function fileApiRequest(type, filePath, { raw = false } = {}) {
  if (!state.fileAccessToken) throw new Error("File access is not ready. Reconnect and try again.");
  const params = new URLSearchParams({ type, path: normalizeBrowserFilePath(filePath) ?? "" });
  const response = await fetch(`/api/files?${params}`, {
    headers: { "X-Codex-File-Token": state.fileAccessToken },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `File request failed (HTTP ${response.status})`);
    error.code = body.code || "FILE_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return raw ? response.blob() : response.json();
}

async function loadExplorerDirectory(directoryPath, { force = false } = {}) {
  const path = normalizeBrowserFilePath(directoryPath) ?? "";
  if (!force && state.explorerChildren.has(path)) return;
  if (state.explorerLoading.has(path)) return;
  state.explorerLoading.add(path);
  state.explorerErrors.delete(path);
  const generation = state.explorerRequestGeneration;
  renderExplorerTree();
  try {
    const result = await fileApiRequest("list", path);
    if (generation !== state.explorerRequestGeneration) return;
    state.explorerChildren.set(path, Array.isArray(result.entries) ? result.entries : []);
    if (result.truncated) state.explorerErrors.set(path, "Only the first 2,000 entries are shown.");
  } catch (error) {
    if (generation !== state.explorerRequestGeneration) return;
    state.explorerErrors.set(path, error.message);
  } finally {
    if (generation === state.explorerRequestGeneration) {
      state.explorerLoading.delete(path);
      renderExplorerTree();
    }
  }
}

function refreshExplorer({ refreshActiveFile = false } = {}) {
  if (!state.fileAccessToken || !state.fileWorkspaceCwd) return;
  const directories = ["", ...state.explorerExpanded];
  state.explorerRequestGeneration += 1;
  if (state.explorerIdleCancel) {
    state.explorerIdleCancel();
    state.explorerIdleCancel = null;
  }
  state.explorerChildren.clear();
  state.explorerLoading.clear();
  state.explorerErrors.clear();
  renderExplorerTree();
  const generation = state.explorerRequestGeneration;
  state.explorerIdleCancel = scheduleIdleTask(() => {
    state.explorerIdleCancel = null;
    if (generation !== state.explorerRequestGeneration) return;
    for (const directory of directories) loadExplorerDirectory(directory, { force: true });
    if (refreshActiveFile && state.activeFilePath) loadFileView(state.activeFilePath, { force: true });
  }, { timeout: 180 });
}

function scheduleFileWorkspaceRefresh() {
  if (state.explorerRefreshTimer) clearTimeout(state.explorerRefreshTimer);
  state.explorerRefreshTimer = setTimeout(() => {
    state.explorerRefreshTimer = null;
    refreshExplorer({ refreshActiveFile: true });
  }, 180);
}

function addFileMention(filePath) {
  const path = normalizeBrowserFilePath(filePath);
  if (!path) return;
  chooseMention({ path: workspaceAbsolutePath(path), name: browserFileName(path) });
}

function renderExplorerEntry(entry, depth, container) {
  const expanded = entry.isDirectory && state.explorerExpanded.has(entry.path);
  const row = document.createElement("div");
  row.className = `explorer-row${expanded ? " expanded" : ""}${state.activeFilePath === entry.path ? " active" : ""}`;
  row.style.setProperty("--explorer-depth", String(depth));
  row.dataset.path = entry.path;
  row.setAttribute("role", "treeitem");
  row.setAttribute("tabindex", "0");
  if (entry.isDirectory) row.setAttribute("aria-expanded", String(expanded));
  row.title = workspaceAbsolutePath(entry.path);
  row.append(entry.isDirectory
    ? iconElement("chevron-right", "explorer-chevron")
    : Object.assign(document.createElement("span"), { className: "explorer-spacer" }));
  row.append(iconElement(entry.isDirectory ? (expanded ? "folder-open" : "folder") : "file-code", "explorer-file-icon"));
  const label = document.createElement("span");
  label.className = "explorer-row-label";
  label.textContent = entry.name;
  row.append(label);

  if (!entry.isDirectory) {
    const mention = document.createElement("button");
    mention.type = "button";
    mention.className = "explorer-mention";
    mention.title = `Mention ${entry.name}`;
    mention.setAttribute("aria-label", mention.title);
    mention.append(iconElement("at-sign"));
    mention.addEventListener("click", (event) => {
      event.stopPropagation();
      addFileMention(entry.path);
    });
    row.append(mention);
  }

  const activate = () => {
    if (entry.isDirectory) {
      if (expanded) state.explorerExpanded.delete(entry.path);
      else {
        state.explorerExpanded.add(entry.path);
        loadExplorerDirectory(entry.path);
      }
      renderExplorerTree();
    } else {
      openFileInPanel(entry.path);
    }
  };
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  });
  renderIcons(row);
  container.append(row);

  if (!expanded) return;
  const children = state.explorerChildren.get(entry.path);
  if (state.explorerLoading.has(entry.path)) {
    const loading = document.createElement("div");
    loading.className = "explorer-loading";
    loading.style.setProperty("--explorer-depth", String(depth + 1));
    loading.textContent = "Loading...";
    container.append(loading);
  } else if (children) {
    for (const child of children) renderExplorerEntry(child, depth + 1, container);
  }
  const error = state.explorerErrors.get(entry.path);
  if (error) {
    const notice = document.createElement("div");
    notice.className = "explorer-loading";
    notice.style.setProperty("--explorer-depth", String(depth + 1));
    notice.textContent = error;
    container.append(notice);
  }
}

function renderExplorerTree() {
  explorerTree.replaceChildren();
  if (!state.fileAccessToken || !state.fileWorkspaceCwd) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "Open a Thread to browse its working directory.";
    explorerTree.append(empty);
    return;
  }
  if (state.explorerLoading.has("") && !state.explorerChildren.has("")) {
    const loading = document.createElement("div");
    loading.className = "explorer-empty";
    loading.textContent = "Loading workspace files...";
    explorerTree.append(loading);
    return;
  }
  const entries = state.explorerChildren.get("");
  if (entries) {
    for (const entry of entries) renderExplorerEntry(entry, 0, explorerTree);
  }
  const error = state.explorerErrors.get("");
  if (error) {
    const notice = document.createElement("div");
    notice.className = "explorer-empty";
    notice.textContent = error;
    explorerTree.append(notice);
  } else if (entries && !entries.length) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "This workspace has no browsable files.";
    explorerTree.append(empty);
  }
}

function emptyFileViewer() {
  const empty = document.createElement("div");
  empty.className = "file-viewer-empty";
  empty.append(iconElement("file"));
  const label = document.createElement("span");
  label.textContent = "Open a file from Explorer or a message link.";
  empty.append(label);
  renderIcons(empty);
  return empty;
}

function renderFileTabs() {
  fileTabs.replaceChildren();
  for (const tab of state.fileTabs) {
    const item = document.createElement("div");
    item.className = `file-tab${tab.path === state.activeFilePath ? " active" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "file-tab-main";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.path === state.activeFilePath));
    select.title = workspaceAbsolutePath(tab.path);
    select.textContent = tab.label;
    select.addEventListener("click", () => selectFileTab(tab.path));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "file-tab-close";
    close.title = `Close ${tab.label}`;
    close.setAttribute("aria-label", close.title);
    close.append(iconElement("x"));
    close.addEventListener("click", () => closeFileTab(tab.path));
    item.append(select, close);
    renderIcons(item);
    fileTabs.append(item);
  }
}

function fileViewerState(message, { error = false, retry = null } = {}) {
  const stateNode = document.createElement("div");
  stateNode.className = `file-viewer-state${error ? " error" : ""}`;
  const label = document.createElement("span");
  label.textContent = message;
  stateNode.append(label);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    stateNode.append(button);
  }
  return stateNode;
}

function renderFileToolbar(data) {
  const toolbar = document.createElement("div");
  toolbar.className = "file-viewer-toolbar";
  const path = document.createElement("code");
  path.className = "file-viewer-path";
  path.textContent = state.activeFilePath;
  path.title = workspaceAbsolutePath(state.activeFilePath);
  const meta = document.createElement("span");
  meta.className = "file-viewer-meta";
  meta.textContent = `${data.language || data.mime || "file"} · ${formatBrowserFileSize(data.size)}`;
  toolbar.append(path, meta);

  if (data.kind === "text" && data.language === "markdown") {
    const modes = document.createElement("div");
    modes.className = "file-viewer-modes";
    const activeMode = state.fileViewModes.get(state.activeFilePath) || "preview";
    for (const mode of ["source", "preview"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-viewer-mode${mode === activeMode ? " active" : ""}`;
      button.textContent = mode === "source" ? "Source" : "Preview";
      button.addEventListener("click", () => {
        state.fileViewModes.set(state.activeFilePath, mode);
        renderFileViewer();
      });
      modes.append(button);
    }
    toolbar.append(modes);
  }

  const mention = document.createElement("button");
  mention.type = "button";
  mention.className = "inline-icon";
  mention.title = "Mention this file";
  mention.setAttribute("aria-label", mention.title);
  mention.append(iconElement("at-sign"));
  mention.addEventListener("click", () => addFileMention(state.activeFilePath));
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "inline-icon";
  copy.title = "Copy full path";
  copy.setAttribute("aria-label", copy.title);
  copy.append(iconElement("copy"));
  copy.addEventListener("click", () => copyField(workspaceAbsolutePath(state.activeFilePath)));
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "inline-icon";
  refresh.title = "Refresh file";
  refresh.setAttribute("aria-label", refresh.title);
  refresh.append(iconElement("refresh-cw"));
  refresh.addEventListener("click", () => loadFileView(state.activeFilePath, { force: true }));
  toolbar.append(mention, copy, refresh);
  renderIcons(toolbar);
  return toolbar;
}

function renderSourceFile(content) {
  const source = document.createElement("div");
  source.className = "file-source";
  sourceFileLines(content).forEach((text, index) => {
    const line = document.createElement("div");
    line.className = "file-source-line";
    const number = document.createElement("span");
    number.className = "file-source-number";
    number.textContent = String(index + 1);
    const code = document.createElement("span");
    code.className = "file-source-code";
    code.textContent = text || " ";
    line.append(number, code);
    source.append(line);
  });
  return source;
}

function renderFileViewer() {
  fileViewer.replaceChildren();
  if (!state.activeFilePath) {
    fileViewer.append(emptyFileViewer());
    return;
  }
  const data = state.fileViewData.get(state.activeFilePath);
  if (!data) {
    fileViewer.append(fileViewerState("Loading file..."));
    return;
  }
  if (data.kind === "error") {
    fileViewer.append(fileViewerState(data.message, {
      error: true,
      retry: () => loadFileView(state.activeFilePath, { force: true }),
    }));
    return;
  }

  fileViewer.append(renderFileToolbar(data));
  const content = document.createElement("div");
  content.className = "file-viewer-content";
  if (data.kind === "image") {
    const imageWrap = document.createElement("div");
    imageWrap.className = "file-image-view";
    const image = document.createElement("img");
    image.src = data.url;
    image.alt = browserFileName(state.activeFilePath);
    imageWrap.append(image);
    content.append(imageWrap);
  } else if (data.language === "markdown" && (state.fileViewModes.get(state.activeFilePath) || "preview") === "preview") {
    const preview = document.createElement("article");
    preview.className = "markdown-body file-markdown-preview";
    preview.dataset.fileLinkBase = browserParentPath(state.activeFilePath);
    renderMarkdown(preview, data.content);
    content.append(preview);
  } else {
    content.append(renderSourceFile(data.content));
  }
  fileViewer.append(content);
}

async function loadFileView(filePath, { force = false } = {}) {
  const path = normalizeBrowserFilePath(filePath);
  if (!path) return;
  if (!force && state.fileViewData.has(path)) {
    renderFileViewer();
    return;
  }
  if (force) {
    revokeFileViewData(state.fileViewData.get(path));
    state.fileViewData.delete(path);
  }
  const request = ++state.fileViewRequest;
  renderFileViewer();
  try {
    let data;
    if (isBrowserImagePath(path)) {
      const blob = await fileApiRequest("raw", path, { raw: true });
      data = { kind: "image", url: URL.createObjectURL(blob), mime: blob.type, size: blob.size };
    } else {
      data = { kind: "text", ...await fileApiRequest("text", path) };
      if (data.language === "markdown" && !state.fileViewModes.has(path)) state.fileViewModes.set(path, "preview");
    }
    if (request !== state.fileViewRequest || path !== state.activeFilePath) {
      revokeFileViewData(data);
      return;
    }
    state.fileViewData.set(path, data);
  } catch (error) {
    if (request !== state.fileViewRequest || path !== state.activeFilePath) return;
    state.fileViewData.set(path, { kind: "error", message: error.message, code: error.code });
  }
  renderFileViewer();
}

function selectFileTab(filePath) {
  const path = normalizeBrowserFilePath(filePath);
  if (!path) return;
  state.activeFilePath = path;
  renderFileTabs();
  renderExplorerTree();
  loadFileView(path);
}

function openFileInPanel(filePath) {
  const path = normalizeBrowserFilePath(filePath);
  if (!path) return false;
  const opened = openBrowserFileTab(state.fileTabs, path);
  state.fileTabs = opened.tabs;
  state.activeFilePath = opened.activePath;
  setRightPanelMode("files");
  renderExplorerTree();
  loadFileView(path);
  return true;
}

function closeFileTab(filePath) {
  const closed = closeBrowserFileTab(state.fileTabs, state.activeFilePath, filePath);
  const removed = state.fileViewData.get(filePath);
  revokeFileViewData(removed);
  state.fileViewData.delete(filePath);
  state.fileViewModes.delete(filePath);
  state.fileTabs = closed.tabs;
  state.activeFilePath = closed.activePath;
  state.fileViewRequest += 1;
  renderFileTabs();
  renderExplorerTree();
  if (!state.fileTabs.length) {
    setRightPanelMode("closed");
    renderFileViewer();
  } else {
    loadFileView(state.activeFilePath);
  }
}

function resolveFileLink(href, basePath = "") {
  const raw = String(href || "");
  const cwd = state.fileWorkspaceCwd || currentCwd();
  if (basePath && !raw.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(raw) && !/^file:/i.test(raw)) {
    return resolveWorkspaceFileHref(`${basePath}/${raw}`, cwd);
  }
  return resolveWorkspaceFileHref(raw, cwd);
}

function openFileLinkFromEvent(event) {
  const anchor = event.target.closest?.("a[href]");
  if (!anchor) return false;
  const base = anchor.closest("[data-file-link-base]")?.dataset.fileLinkBase || "";
  const path = resolveFileLink(anchor.getAttribute("href"), base);
  if (path === null || path === "") return false;
  event.preventDefault();
  openFileInPanel(path);
  return true;
}

function stopActivityTimer() {
  if (!state.activityTimer) return;
  clearInterval(state.activityTimer);
  state.activityTimer = null;
}

function isSnapshotMode() {
  return state.accessMode === "snapshot";
}

function isThreadWritable() {
  const lifecycle = String(state.threadStatus || "").toLowerCase();
  return !isSnapshotMode()
    && state.threadMeta?.archived !== true
    && state.threadMeta?.closed !== true
    && !["archived", "closed"].includes(lifecycle);
}

function requireWritable(action = "perform this action") {
  if (isThreadWritable()) return true;
  const message = isSnapshotMode()
    ? `Cannot ${action} while this thread is a read-only snapshot. Refresh or fork it first.`
    : `Cannot ${action} because this thread is ${String(state.threadStatus || "closed")}.`;
  addSystemMessage(message, "warning");
  return false;
}

function snapshotTimeLabel(value) {
  const ms = timestampToMs(value);
  if (!Number.isFinite(ms)) return "unknown time";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ms));
}

function renderSnapshotBanner() {
  if (!snapshotBanner) return;
  const visible = isSnapshotMode() && Boolean(state.threadId);
  snapshotBanner.classList.toggle("hidden", !visible);
  if (!visible) return;
  snapshotBannerText.textContent = formatSnapshotBannerText({
    accessMode: state.accessMode,
    snapshotAt: state.snapshotAt,
    snapshotReason: state.snapshotReason,
  });
  refreshSnapshotButton.disabled = !state.ready;
}

function protocolItemForNotification(params = {}, fallback = null) {
  const item = params.item && typeof params.item === "object" ? params.item : fallback;
  if (item) return item;
  if (params.itemId === undefined || params.itemId === null) return null;
  return getProtocolItem(state.protocolState, params.itemId);
}

function agentActivityName(item = {}) {
  return presentAgentActivity(item).name;
}

function applyProtocolNotification(message) {
  if (!message || !message.method) return null;
  state.protocolState = reduceProtocolState(state.protocolState, message);
  rememberProtocolEventOrder(message);
  return protocolItemForNotification(message.params || {});
}

function activeProtocolItems() {
  return (Array.isArray(state.protocolState?.items) ? state.protocolState.items : [])
    .filter((item) => {
      const status = normalizeToolStatus(item?.status ?? item?.state ?? item?.result ?? item?.kind);
      return status.isActive || ["pending", "waiting", "pendinginit"].includes(String(item?.status ?? item?.state ?? item?.kind ?? "").toLowerCase());
    });
}

function protocolActivityLabel(item) {
  if (!item) return "Working";
  const type = item.type || "unknown";
  if (["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(type)) {
    return presentAgentActivity(item).label;
  }
  if (type === "fileChange") return "Updating files";
  if (type === "mcpToolCall") return `Running MCP · ${item.tool || "tool"}`;
  if (type === "dynamicToolCall") return `Running ${item.tool || item.name || "dynamic tool"}`;
  if (type === "webSearch") return "Searching web...";
  if (type === "imageView") return "Viewing image";
  if (type === "imageGeneration") return "Generating image";
  if (type === "contextCompaction") return "Compacting context";
  if (type === "commandExecution") {
    const presentation = presentCommand(item);
    const detail = presentation.actionSummary || presentation.summary;
    return detail ? `Running command · ${detail}` : "Running command";
  }
  if (["reasoning", "thinking"].includes(type)) return "Thinking";
  if (type === "plan") return "Planning";
  return `Working · ${type}`;
}

const SNAPSHOT_LIFECYCLE_METHODS = new Set([
  "thread/deleted",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
]);

function shouldProcessSnapshotNotification(method) {
  if (!/^(?:item|turn|thread\/|model\/)/.test(String(method || ""))) return true;
  return SNAPSHOT_LIFECYCLE_METHODS.has(method);
}

function syncActivityFromProtocol() {
  if (isSnapshotMode()) return;
  if (state.userInputRequest) {
    setTurnActivityWorking(null, "Waiting for your input");
    return;
  }
  if (state.approvals.length) {
    setTurnActivityWorking(null, "Approval required");
    return;
  }
  const active = activeProtocolItems();
  if (!active.length) {
    if (state.running) setTurnActivityWorking(null, "Working");
    return;
  }
  const priority = (item) => {
    const type = item?.type;
    if (type === "agentStatus" || ["collabToolCall", "collabAgentToolCall", "subAgentActivity"].includes(type)) return 80;
    if (["fileChange", "mcpToolCall", "dynamicToolCall"].includes(type)) return 70;
    if (type === "commandExecution") return 60;
    if (type === "webSearch") return 50;
    return 10;
  };
  const current = [...active].sort((a, b) => priority(b) - priority(a)).at(0);
  setTurnActivityWorking(null, protocolActivityLabel(current));
}

function renderTurnActivity() {
  if (!turnActivity) return;
  if (isSnapshotMode()) {
    stopActivityTimer();
    turnActivity.className = "turn-activity hidden";
    turnActivity.replaceChildren();
    turnActivity.removeAttribute("aria-label");
    turnActivity.dataset.renderKey = "snapshot";
    return;
  }
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
  if (isSnapshotMode()) {
    clearTurnActivity();
    return;
  }
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
  if (isSnapshotMode()) {
    clearTurnActivity();
    return;
  }
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
  state.steerRequestThreads.clear();
  renderQueueShelf();
}

function consumeIgnoredQueueResponse(requestId) {
  if (!requestId || !state.ignoredQueueRequestIds.has(requestId)) return false;
  state.ignoredQueueRequestIds.delete(requestId);
  return true;
}

function drainQueue() {
  if (state.running || queueDispatchActive(state.threadId) || !state.threadId || !isThreadWritable()) return false;
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
  if (!requireWritable("queue a follow-up")) return false;
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
  if (!requireWritable("steer the active turn")) return false;
  if (!state.threadId || !state.activeTurnId) {
    addSystemMessage("There is no steerable active turn.", "warning");
    return false;
  }
  const requestId = queueRequestId();
  state.steerRequestInputs.set(requestId, input);
  state.steerRequestThreads.set(requestId, state.threadId);
  const sent = send({
    type: "steerMessage",
    requestId,
    threadId: state.threadId,
    expectedTurnId: state.activeTurnId,
    clientUserMessageId: requestId,
    input,
  });
  if (!sent) {
    state.steerRequestInputs.delete(requestId);
    state.steerRequestThreads.delete(requestId);
  }
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
  const snapshot = isSnapshotMode();
  const historyPending = state.historyRestoring;
  const accessControls = accessControlState({
    accessMode: state.accessMode,
    hasThread,
    running: state.running,
    awaitingUserInput: Boolean(state.userInputRequest),
    threadWritable: isThreadWritable(),
  });
  // Thread selection and new-thread creation remain available while another
  // runtime is running; only mutations on the selected thread are gated.
  const canStart = state.ready;
  // Configuration changes are thread mutations too. Keep archived/closed
  // threads consistent with the send/steer/approval guards while still
  // allowing settings to be chosen before a brand-new thread exists.
  const canConfigure = canStart && !state.selectionPending && !historyPending && isThreadWritable();
  modelSelect.disabled = !canConfigure;
  effortSelect.disabled = !canConfigure || !modelSelect.value;
  collaborationModeSelect.disabled = !canConfigure || !collaborationModeSelect.options.length || collaborationModeSelect.options[0].value === "";
  tierSelect.disabled = !canConfigure || !modelSelect.value;
  permissionSelect.disabled = !canConfigure;
  inspectorModelSelect.disabled = !canConfigure;
  inspectorEffortSelect.disabled = !canConfigure || !modelSelect.value;
  inspectorCollaborationModeSelect.disabled = !canConfigure || !collaborationModeSelect.options.length || collaborationModeSelect.options[0].value === "";
  newThreadButton.disabled = !canStart || state.selectionPending || historyPending;
  refreshThreadsButton.disabled = !state.ready || state.threadListLoading;
  loadMoreThreadsButton.disabled = !state.ready || state.threadListLoading;
  statusButton.disabled = !state.ready;
  const awaitingUserInput = Boolean(state.userInputRequest);
  messageInput.disabled = !state.ready || state.selectionPending || historyPending || !hasThread || !accessControls.canWrite || awaitingUserInput;
  sendButton.disabled = !state.ready || state.selectionPending || historyPending || !accessControls.canSend;
  stopButton.disabled = !state.ready || state.selectionPending || historyPending || !accessControls.canInterrupt;
  stopButton.classList.toggle("hidden", !accessControls.showInterrupt);
  sendButton.classList.toggle("hidden", snapshot || state.running);
  steerButton.disabled = !state.ready || state.selectionPending || historyPending || !accessControls.canSteer;
  followUpButton.disabled = !state.ready || state.selectionPending || historyPending || !accessControls.canSteer;
  steerButton.classList.toggle("hidden", snapshot || !state.running);
  followUpButton.classList.toggle("hidden", snapshot || !state.running);
  if (mentionButton) mentionButton.disabled = !hasThread || snapshot || awaitingUserInput;
  if (imageInput) imageInput.disabled = !hasThread || snapshot || awaitingUserInput;
  if (attachButton) attachButton.classList.toggle("disabled", !hasThread || snapshot || awaitingUserInput);
  renderQueueShelf();

  const model = currentModelLabel();
  const effort = displayEffortLabel();
  const tier = currentTierLabel();
  const mode = currentCollaborationModeLabel();
  sessionSummary.textContent = hasThread
    ? `${model} ${effort}${tier !== "default" ? ` / ${tier}` : ""}${mode !== "default" ? ` / ${mode}` : ""}`
    : "No active thread";
  directorySummary.textContent = currentCwd();
  runStatus.textContent = snapshot ? "snapshot" : state.threadStatus || (state.running ? "active" : hasThread ? "idle" : "notLoaded");
  runStatus.className = `pill status-${snapshot ? "snapshot" : String(state.threadStatus || "unknown").replace(/[^a-zA-Z]/g, "").toLowerCase()}`;
  renderTurnActivity();
  renderSnapshotBanner();

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
  const selectionBlocked = !canBeginThreadSelection(state.selectionPending);
  $("#backThreadButton").disabled = selectionBlocked || navIndex <= 0;
  $("#forwardThreadButton").disabled = selectionBlocked || navIndex < 0 || navIndex >= state.navigation.items.length - 1;
  syncThreadListControls();
}

function createThreadUiState() {
  return {
    diffInteractionVersion: 2,
    activeOutlineMessageId: null,
    expandedFileChanges: [],
    expandedDiffFiles: [],
    expandedCommands: [],
    collapsedCommands: [],
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

function protocolStateStorageKey(threadId) {
  return `codexProtocolState:${threadId}`;
}

function readProtocolState(threadId) {
  if (!threadId) return createProtocolState();
  try {
    const stored = JSON.parse(sessionStorage.getItem(protocolStateStorageKey(threadId)) || "null");
    return createProtocolState(stored || {});
  } catch {
    return createProtocolState();
  }
}

function saveProtocolState() {
  if (!state.threadId || !state.protocolState) return;
  const snapshot = toProtocolSnapshot(state.protocolState);
  // Keep only protocol metadata and structured plans in browser session state;
  // command output and MCP payloads remain in the existing short-lived cache.
  const compact = {
    sequence: snapshot.sequence,
    plans: snapshot.plans,
    orderedEvents: snapshot.orderedEvents.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      itemId: entry.itemId || null,
      planKey: entry.planKey || null,
      sequence: entry.sequence,
      type: entry.type || null,
      threadId: entry.threadId || null,
      turnId: entry.turnId || null,
      previousKey: entry.previousKey || null,
    })),
    counts: snapshot.counts,
  };
  try { sessionStorage.setItem(protocolStateStorageKey(state.threadId), JSON.stringify(compact)); } catch {
    // Session storage is optional; live protocol state remains authoritative.
  }
}

function protocolEntryForItem(itemId) {
  if (itemId === undefined || itemId === null) return null;
  const id = String(itemId);
  return [...(state.protocolState?.orderedEvents || [])]
    .find((entry) => entry.kind === "item" && String(entry.itemId || "") === id) || null;
}

function protocolEntryForPlan(planKey) {
  if (!planKey) return null;
  return [...(state.protocolState?.orderedEvents || [])]
    .find((entry) => entry.kind === "plan" && entry.planKey === planKey) || null;
}

function protocolSequenceForItem(itemId) {
  const historyRank = Number(state.historyOrderRanks.get(`item:${itemId}`));
  if (Number.isFinite(historyRank)) return historyRank;
  const entry = protocolEntryForItem(itemId);
  return optionalConversationSequence(entry?.sequence ?? state.protocolState?.itemSequences?.get?.(String(itemId)));
}

function protocolSequenceForPlan(planKey) {
  const historyRank = Number(state.historyOrderRanks.get(`plan:${planKey}`));
  if (Number.isFinite(historyRank)) return historyRank;
  const entry = protocolEntryForPlan(planKey);
  return optionalConversationSequence(entry?.sequence ?? state.protocolState?.planSequences?.get?.(planKey));
}

function rebuildHistoryOrderRanks() {
  state.historyOrderRanks.clear();
  const items = Array.isArray(state.threadView?.items) ? state.threadView.items : [];
  const orderedKeys = [];
  const seen = new Set();
  const aliases = new Map();
  const addKey = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    orderedKeys.push(key);
  };
  for (const item of items) {
    if (!item?.id) continue;
    if (item.type === "plan" || item.viewType === "plan") {
      const planKey = planSnapshotKey(state.threadId, item.turnId || item.id);
      addKey(`plan:${planKey}`);
      // The history plan item is rendered by the plan card, but keep its
      // item key at the same rank for protocol nodes restored from storage.
      aliases.set(`item:${item.id}`, `plan:${planKey}`);
      continue;
    }
    addKey(`item:${item.id}`);
  }

  const storedPlans = [...(state.protocolState?.orderedEvents || [])]
    .filter((entry) => entry.kind === "plan" && entry.planKey)
    .sort((left, right) => (optionalConversationSequence(left.sequence) ?? Number.POSITIVE_INFINITY)
      - (optionalConversationSequence(right.sequence) ?? Number.POSITIVE_INFINITY));
  for (const entry of storedPlans) {
    const key = `plan:${entry.planKey}`;
    if (seen.has(key)) continue;
    const previousIndex = entry.previousKey ? orderedKeys.indexOf(entry.previousKey) : -1;
    if (previousIndex >= 0) orderedKeys.splice(previousIndex + 1, 0, key);
    else {
      const protocolEntries = [...(state.protocolState?.orderedEvents || [])]
        .filter((candidate) => candidate.key !== entry.key)
        .sort((left, right) => (optionalConversationSequence(left.sequence) ?? Number.POSITIVE_INFINITY)
          - (optionalConversationSequence(right.sequence) ?? Number.POSITIVE_INFINITY));
      const entrySequence = optionalConversationSequence(entry.sequence);
      const nextIndex = protocolEntries
        .filter((candidate) => entrySequence !== null
          && optionalConversationSequence(candidate.sequence) > entrySequence)
        .map((candidate) => orderedKeys.indexOf(candidate.key))
        .find((index) => index >= 0);
      if (nextIndex !== undefined) orderedKeys.splice(nextIndex, 0, key);
      else {
        const previousProtocolIndex = protocolEntries
          .filter((candidate) => entrySequence !== null
            && optionalConversationSequence(candidate.sequence) < entrySequence)
          .map((candidate) => orderedKeys.indexOf(candidate.key))
          .filter((index) => index >= 0)
          .at(-1);
        if (previousProtocolIndex === undefined) orderedKeys.push(key);
        else orderedKeys.splice(previousProtocolIndex + 1, 0, key);
      }
    }
    seen.add(key);
  }
  orderedKeys.forEach((key, index) => state.historyOrderRanks.set(key, index + 1));
  for (const [alias, target] of aliases) {
    const rank = state.historyOrderRanks.get(target);
    if (rank !== undefined) state.historyOrderRanks.set(alias, rank);
  }
}

function protocolEventKeyForMessage(message = {}) {
  if (message?.params?.itemId !== undefined && message?.params?.itemId !== null) {
    return `item:${message.params.itemId}`;
  }
  const itemId = message?.params?.item?.id;
  return itemId === undefined || itemId === null ? null : `item:${itemId}`;
}

function rememberProtocolEventOrder(message) {
  const method = String(message?.method || "");
  const params = message?.params || {};
  const key = method === "turn/plan/updated"
    ? `plan:${planSnapshotKey(params.threadId || state.threadId, params.turnId || state.activeTurnId)}`
    : protocolEventKeyForMessage(message);
  if (!key) return;
  const entry = state.protocolState?.orderedEvents?.find((candidate) => candidate.key === key);
  if (!entry) return;
  if (entry.previousKey === undefined) {
    const entrySequence = optionalConversationSequence(entry.sequence);
    const prior = [...state.protocolState.orderedEvents]
      .filter((candidate) => candidate.key !== key && entrySequence !== null
        && optionalConversationSequence(candidate.sequence) < entrySequence)
      .sort((left, right) => (optionalConversationSequence(left.sequence) ?? Number.POSITIVE_INFINITY)
        - (optionalConversationSequence(right.sequence) ?? Number.POSITIVE_INFINITY))
      .at(-1);
    entry.previousKey = prior?.key || null;
  }
  if (entry.threadId === undefined) entry.threadId = params.threadId || state.threadId || null;
  if (entry.turnId === undefined) {
    entry.turnId = params.turnId || params.item?.turnId || state.activeTurnId || state.currentTurn?.id || null;
  }
}

function optionalConversationSequence(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const sequence = Number(value);
  return Number.isFinite(sequence) ? sequence : null;
}

function nextFallbackConversationSequence(protocolSequence, index) {
  const anchor = optionalConversationSequence(protocolSequence) ?? 0;
  const position = Math.max(0, Math.trunc(Number(index) || 0));
  return anchor + 1 - (1 / (position + 2));
}

function fallbackConversationSequence() {
  const anchor = optionalConversationSequence(state.protocolState?.sequence) ?? 0;
  if (state.conversationFallbackAnchor !== anchor) {
    state.conversationFallbackAnchor = anchor;
    state.conversationFallbackIndex = 0;
  }
  const sequence = nextFallbackConversationSequence(anchor, state.conversationFallbackIndex);
  state.conversationFallbackIndex += 1;
  return sequence;
}

function conversationNodeCompare(left, right) {
  const leftSequence = optionalConversationSequence(left.meta?.sequence) ?? Number.POSITIVE_INFINITY;
  const rightSequence = optionalConversationSequence(right.meta?.sequence) ?? Number.POSITIVE_INFINITY;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return left.meta.ordinal - right.meta.ordinal;
}

function reconcileConversationNodes() {
  if (state.historyRestoring) {
    state.conversationReconcilePending = true;
    return;
  }
  if (!chat || state.conversationNodeMeta.size < 2) return;
  const children = [...chat.children];
  const decorated = children.map((node, index) => ({
    node,
    index,
    meta: state.conversationNodeMeta.get(node),
  }));
  decorated.sort((left, right) => {
    if (!left.meta && !right.meta) return left.index - right.index;
    if (!left.meta) return -1;
    if (!right.meta) return 1;
    return conversationNodeCompare(left, right);
  });
  for (let index = 0; index < decorated.length; index += 1) {
    const node = decorated[index].node;
    const current = chat.children[index];
    if (current !== node) chat.insertBefore(node, current || null);
  }
}

function registerConversationNode(node, { sequence = null, key = null, turnId = null } = {}) {
  if (!node) return node;
  const nextSequence = optionalConversationSequence(sequence);
  const existing = state.conversationNodeMeta.get(node);
  if (existing) {
    const existingSequence = optionalConversationSequence(existing.sequence);
    if (nextSequence !== null && (existingSequence === null || nextSequence < existingSequence)) {
      existing.sequence = nextSequence;
    }
    if (key && !existing.key) existing.key = key;
    if (turnId !== null && existing.turnId === null) existing.turnId = turnId;
  } else {
    state.conversationNodeMeta.set(node, {
      sequence: nextSequence ?? fallbackConversationSequence(),
      key,
      turnId,
      ordinal: state.conversationNodeOrdinal++,
    });
  }
  if (state.historyRestoring) state.conversationReconcilePending = true;
  else reconcileConversationNodes();
  return node;
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
  state.expandedMcpTools = new Set(state.threadUi.expandedMcpTools);
  state.expandedCommandOutputs = new Set(state.threadUi.expandedCommandOutputs);
  state.expandedProcesses = new Set(state.threadUi.expandedProcesses);
  state.activeOutlineMessageId = state.threadUi.activeOutlineMessageId || null;
}

const MINIMAP_PREVIEW_HIDE_DELAY = 250;
const MINIMAP_ACTIVE_LOCK_MS = 1600;

function conversationTargetOffset(element) {
  if (!element?.isConnected) return null;
  const chatRect = chat.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  return targetRect.top - chatRect.top + chat.scrollTop;
}

function conversationMinimapTurns() {
  const turns = [];
  let currentTurn = null;

  for (const record of state.messageNodes.values()) {
    if (record.role === "user") {
      currentTurn = { user: record, assistantCandidates: [], assistants: [] };
      turns.push(currentTurn);
      continue;
    }
    if (record.role === "assistant" && currentTurn && String(record.raw || "").trim()) {
      currentTurn.assistantCandidates.push(record);
    }
  }

  for (const turn of turns) {
    const visibleAnswers = turn.assistantCandidates.filter((record) => (
      !record.process || record.streaming || state.historicalProcessAnswerIds.has(record.id)
    ));
    turn.assistants = visibleAnswers.length ? visibleAnswers : turn.assistantCandidates.slice(-1);
  }
  return turns;
}

function scrollConversationTarget(element, turnIndex, behavior = "smooth") {
  const turn = state.outlineTurns[turnIndex];
  const targetTop = conversationTargetOffset(element);
  if (!turn || targetTop === null) return;
  state.outlineActiveLock = { index: turnIndex, until: Date.now() + MINIMAP_ACTIVE_LOCK_MS };
  setActiveOutlineMessage(turn.user.id);
  chat.scrollTo({
    top: Math.max(0, targetTop - chat.clientHeight * 0.3),
    behavior,
  });
}

function cleanPreviewClone(node) {
  let clone = node.cloneNode(true);
  if (clone.nodeType === Node.ELEMENT_NODE && ["A", "BUTTON"].includes(clone.tagName)) {
    const replacement = document.createElement("span");
    replacement.append(...clone.childNodes);
    clone = replacement;
  }
  const elements = clone.nodeType === Node.ELEMENT_NODE
    ? [clone, ...clone.querySelectorAll("*")]
    : [];
  for (const element of elements) {
    element.removeAttribute?.("id");
    if (element !== clone && ["A", "BUTTON"].includes(element.tagName)) {
      const replacement = document.createElement("span");
      replacement.append(...element.childNodes);
      element.replaceWith(replacement);
    }
  }
  return clone;
}

function appendPreviewContent(target, source, fallback) {
  if (source?.childNodes?.length) {
    target.append(...[...source.childNodes].map(cleanPreviewClone));
    return;
  }
  target.textContent = conversationPreviewText(fallback);
}

function createMinimapButton(className, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function appendAssistantPreview(container, turn, assistant, turnIndex, assistantIndex) {
  const section = document.createElement("section");
  section.className = "chat-minimap-assistant";

  const jump = createMinimapButton(
    "chat-minimap-assistant-jump",
    "Locate assistant message",
    () => scrollConversationTarget(assistant.article, turnIndex),
  );
  jump.textContent = "A";
  jump.title = "Locate assistant message";

  const outline = document.createElement("div");
  outline.className = "chat-minimap-assistant-outline";
  const headings = [...assistant.content.querySelectorAll("h1, h2, h3")];

  if (headings.length) {
    headings.forEach((heading, headingIndex) => {
      const level = Number(heading.tagName.slice(1));
      const button = createMinimapButton(
        "chat-minimap-heading",
        `Locate assistant heading ${headingIndex + 1}`,
        () => scrollConversationTarget(heading, turnIndex),
      );
      button.dataset.level = String(level);
      button.dataset.previewHeadingIndex = String(headingIndex);
      button.dataset.minimapPreviewHeading = `${turnIndex}-${assistantIndex}-${headingIndex}`;
      appendPreviewContent(button, heading, heading.textContent || assistant.raw);
      outline.append(button);
    });
  } else {
    const paragraph = assistant.content.querySelector("p");
    const button = createMinimapButton(
      "chat-minimap-paragraph",
      "Locate assistant message",
      () => scrollConversationTarget(assistant.article, turnIndex),
    );
    appendPreviewContent(button, paragraph, assistant.raw);
    outline.append(button);
  }

  section.append(jump, outline);
  container.append(section);
}

function setActiveOutlineMessage(messageId, persist = true) {
  const nextId = messageId || null;
  if (state.activeOutlineMessageId === nextId && state.activeOutlineNode?.preview?.isConnected) return;
  state.activeOutlineNode?.rail?.classList.remove("active");
  state.activeOutlineNode?.preview?.classList.remove("active");
  state.activeOutlineNode?.preview?.removeAttribute("aria-current");
  state.activeOutlineMessageId = nextId;
  state.activeOutlineNode = state.outlineNodes.get(nextId) || null;
  state.activeOutlineNode?.rail?.classList.add("active");
  state.activeOutlineNode?.preview?.classList.add("active");
  state.activeOutlineNode?.preview?.setAttribute("aria-current", "true");
  if (persist) scheduleThreadUiSave();
}

function setLocatedOutlineMessage(messageId) {
  const nextId = messageId || null;
  if (state.locatedOutlineMessageId === nextId) return;
  const previous = state.outlineNodes.get(state.locatedOutlineMessageId);
  previous?.rail?.classList.remove("located");
  if (previous?.preview) delete previous.preview.dataset.located;
  state.locatedOutlineMessageId = nextId;
  const next = state.outlineNodes.get(nextId);
  next?.rail?.classList.add("located");
  if (next?.preview) {
    next.preview.dataset.located = "true";
    const targetTop = next.preview.offsetTop
      - (conversationOutline.clientHeight - next.preview.offsetHeight) / 2;
    conversationOutline.scrollTop = Math.max(0, targetTop);
  }
}

function syncConversationMinimapActive() {
  if (!state.outlineTurns.length) {
    setActiveOutlineMessage(null);
    return;
  }
  const lock = state.outlineActiveLock;
  if (lock && Date.now() < lock.until && state.outlineTurns[lock.index]) {
    setActiveOutlineMessage(state.outlineTurns[lock.index].user.id);
    return;
  }
  state.outlineActiveLock = null;
  const offsets = state.outlineTurns.map((turn) => conversationTargetOffset(turn.user.article));
  const activeIndex = activeConversationTurnIndex(offsets, chat.scrollTop, chat.clientHeight);
  setActiveOutlineMessage(state.outlineTurns[activeIndex]?.user.id || null);
}

function hideConversationMinimap() {
  chatMinimap.classList.add("hidden");
  chatMinimap.setAttribute("aria-hidden", "true");
  chatMinimap.classList.remove("preview-open");
  conversationView.classList.remove("minimap-visible");
}

function measureConversationMinimap() {
  const eligible = window.innerWidth >= 960
    && state.activeView === "conversation"
    && state.outlineTurns.length > 0;
  if (!eligible) {
    hideConversationMinimap();
    return;
  }

  conversationView.classList.add("minimap-visible");
  chatMinimap.classList.remove("hidden");
  chatMinimap.setAttribute("aria-hidden", "false");
  if (chat.scrollHeight - chat.clientHeight <= 20) {
    hideConversationMinimap();
    return;
  }

  const layout = layoutConversationMinimap(state.outlineTurns.length, chatMinimap.clientHeight);
  state.outlineLayout = layout;
  chatMinimapLine.style.top = `${layout.lineTop}px`;
  chatMinimapLine.style.height = `${layout.lineHeight}px`;
  state.outlineTurns.forEach((turn, index) => {
    const entry = state.outlineNodes.get(turn.user.id);
    if (!entry?.rail) return;
    entry.rail.style.top = `${layout.positions[index]}px`;
    entry.rail.style.height = `${Math.max(1, layout.gap)}px`;
  });
  syncConversationMinimapActive();
}

function scheduleConversationOutlineRender() {
  if (state.historyRestoring || state.historyObserverMuted) {
    state.conversationReconcilePending = true;
    return;
  }
  if (state.outlineRenderTimer !== null) return;
  state.outlineRenderTimer = setTimeout(() => {
    state.outlineRenderTimer = null;
    renderConversationOutline();
  }, 120);
}

function renderConversationOutline() {
  const locatedId = state.locatedOutlineMessageId;
  conversationOutline.replaceChildren();
  chatMinimapRail.replaceChildren(chatMinimapLine);
  state.outlineNodes.clear();
  state.activeOutlineNode = null;
  state.locatedOutlineMessageId = null;
  state.outlineTurns = conversationMinimapTurns();

  state.outlineTurns.forEach((turn, index) => {
    const railNode = document.createElement("span");
    railNode.className = "chat-minimap-node";
    railNode.dataset.minimapNodeIndex = String(index);
    railNode.setAttribute("aria-hidden", "true");
    const marker = document.createElement("span");
    marker.className = "chat-minimap-node-marker";
    railNode.append(marker);
    chatMinimapRail.append(railNode);

    const preview = document.createElement("section");
    preview.className = "chat-minimap-turn";
    preview.dataset.minimapPreviewIndex = String(index);
    preview.dataset.messageId = turn.user.id;
    const number = document.createElement("span");
    number.className = "chat-minimap-number";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "chat-minimap-content";
    const userButton = createMinimapButton(
      "chat-minimap-user",
      `Locate user message ${index + 1}`,
      () => scrollConversationTarget(turn.user.article, index),
    );
    userButton.dataset.minimapPreviewUser = String(index);
    userButton.title = conversationPreviewText(turn.user.raw);
    const userText = document.createElement("span");
    userText.className = "chat-minimap-user-text";
    userText.textContent = String(turn.user.raw || "").trim() || "Untitled message";
    userButton.append(userText);
    content.append(userButton);
    turn.assistants.forEach((assistant, assistantIndex) => {
      appendAssistantPreview(content, turn, assistant, index, assistantIndex);
    });
    preview.append(number, content);
    conversationOutline.append(preview);
    state.outlineNodes.set(turn.user.id, { rail: railNode, preview, turn, index });
  });

  const preferredId = state.outlineNodes.has(state.activeOutlineMessageId)
    ? state.activeOutlineMessageId
    : state.outlineTurns[0]?.user.id || null;
  state.activeOutlineMessageId = null;
  setActiveOutlineMessage(preferredId, false);
  if (chatMinimap.classList.contains("preview-open") && state.outlineNodes.has(locatedId)) {
    setLocatedOutlineMessage(locatedId);
  }
  requestAnimationFrame(measureConversationMinimap);
}

function showConversationMinimapPreview() {
  if (state.outlinePreviewHideTimer !== null) {
    clearTimeout(state.outlinePreviewHideTimer);
    state.outlinePreviewHideTimer = null;
  }
  if (!chatMinimap.classList.contains("hidden")) chatMinimap.classList.add("preview-open");
}

function scheduleConversationMinimapPreviewHide() {
  if (state.outlinePreviewHideTimer !== null) clearTimeout(state.outlinePreviewHideTimer);
  state.outlinePreviewHideTimer = setTimeout(() => {
    state.outlinePreviewHideTimer = null;
    chatMinimap.classList.remove("preview-open");
    setLocatedOutlineMessage(null);
  }, MINIMAP_PREVIEW_HIDE_DELAY);
}

function minimapPointerIndex(clientY) {
  if (!state.outlineLayout) return -1;
  const rect = chatMinimapRail.getBoundingClientRect();
  return nearestConversationMinimapIndex(state.outlineLayout, clientY - rect.top);
}

function locateConversationMinimapPointer(clientY) {
  const index = minimapPointerIndex(clientY);
  setLocatedOutlineMessage(state.outlineTurns[index]?.user.id || null);
  return index;
}

function jumpToConversationMinimapPointer(clientY, behavior) {
  const index = locateConversationMinimapPointer(clientY);
  const turn = state.outlineTurns[index];
  if (turn) scrollConversationTarget(turn.user.article, index, behavior);
}

function beginConversationMinimapDrag(event) {
  if (event.button !== 0 || chatMinimap.classList.contains("hidden")) return;
  event.preventDefault();
  showConversationMinimapPreview();
  jumpToConversationMinimapPointer(event.clientY, "smooth");
  const onMove = (moveEvent) => jumpToConversationMinimapPointer(moveEvent.clientY, "auto");
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function handleConversationMinimapKeydown(event) {
  if (!state.outlineTurns.length) return;
  const activeIndex = Math.max(0, state.outlineTurns.findIndex((turn) => turn.user.id === state.activeOutlineMessageId));
  let nextIndex = activeIndex;
  if (["ArrowDown", "ArrowRight"].includes(event.key)) nextIndex = Math.min(state.outlineTurns.length - 1, activeIndex + 1);
  else if (["ArrowUp", "ArrowLeft"].includes(event.key)) nextIndex = Math.max(0, activeIndex - 1);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = state.outlineTurns.length - 1;
  else if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const turn = state.outlineTurns[nextIndex];
  scrollConversationTarget(turn.user.article, nextIndex);
  setLocatedOutlineMessage(turn.user.id);
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
  state.threadRuntimes.runtimes.delete(id);
  sessionStorage.removeItem(threadUiStorageKey(id));
  sessionStorage.removeItem(`codexScroll:${id}`);
  sessionStorage.removeItem(threadToolStorageKey(id));
  sessionStorage.removeItem(protocolStateStorageKey(id));
  localStorage.removeItem(collaborationModeStorageKey(id));
}

function resetActiveThreadAfterDeletion(threadId) {
  const deletedId = String(threadId || state.threadId || "").trim();
  clearDeletedThreadBrowserState(deletedId);
  clearTranscript(false);
  state.outlineNodes.clear();
  state.outlineTurns = [];
  state.outlineLayout = null;
  state.activeOutlineNode = null;
  state.activeOutlineMessageId = null;
  state.commandItems.clear();
  state.changeItems.clear();
  state.threadView = normalizeThread({});
  state.threadUi = null;
  state.lastSavedThreadUi = null;
  state.threadId = null;
  state.selectedThreadId = null;
  persistSelectedThread(null);
  state.accessMode = null;
  state.snapshotAt = null;
  state.snapshotReason = null;
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
  state.pendingServerRequests.clear();
  state.navigation = removeThreadFromNavigation(state.navigation, deletedId);
  state.navigatingHistory = false;
  state.expandedFileChanges.clear();
  state.expandedDiffFiles.clear();
  state.expandedCommands.clear();
  state.collapsedCommands.clear();
  state.expandedMcpTools.clear();
  state.expandedCommandOutputs.clear();
  state.expandedProcesses.clear();
  clearQueuedMessages();
  resetFileWorkspace(state.defaultCwd || "", { keepPanel: false, force: true });
  localStorage.removeItem("codexMathThreadId");
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

function updateCurrentThreadListMetadata(fields = {}) {
  if (!state.threadId || !fields || typeof fields !== "object") return;
  const index = state.threads.findIndex((thread) => thread.id === state.threadId);
  if (index < 0) return;
  state.threads[index] = { ...state.threads[index], ...fields };
  renderThreadList();
}

function setThreadLifecycle(status, fields = {}) {
  state.threadStatus = status;
  state.threadMeta = { ...state.threadMeta, ...fields };
  if (status !== "active") {
    state.running = false;
    state.activeTurnId = null;
    if (state.activityMode === "working") clearTurnActivity();
  }
  updateControls();
  refreshThreadList();
}

function threadListStructureKey(groups) {
  return groups.map((group) => `${group.label}:${group.threads.map((thread) => thread.id).join(",")}`).join("|");
}

function createThreadRow(thread) {
  const item = document.createElement("div");
  item.className = "thread-item";
  item.dataset.threadId = thread.id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thread-item-main";
  const title = document.createElement("span");
  title.className = "thread-item-title";
  const time = document.createElement("time");
  time.className = "thread-item-time";
  const timeText = document.createTextNode("");
  const stateMark = document.createElement("span");
  stateMark.className = "thread-item-runtime";
  time.append(timeText, stateMark);
  const cwd = document.createElement("span");
  cwd.className = "thread-item-cwd";
  button.append(title, time, cwd);
  button.addEventListener("click", () => {
    const id = item.dataset.threadId;
    if (!canBeginThreadSelection(state.selectionPending)) return;
    if (id !== state.selectedThreadId || id !== state.threadId) resumeThread(id);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "thread-item-delete icon-button";
  deleteButton.title = "Delete conversation";
  const deleteIcon = document.createElement("i");
  deleteIcon.dataset.icon = "trash-2";
  deleteButton.append(deleteIcon);
  renderIcons(deleteButton);
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = state.threads.find((candidate) => candidate.id === item.dataset.threadId);
    if (current) openDeleteThreadDialog(current);
  });
  item.append(button, deleteButton);
  item._threadParts = { button, title, timeText, stateMark, cwd, deleteButton };
  return item;
}

function patchThreadRow(item, thread) {
  const parts = item._threadParts;
  if (!parts) return;
  const active = thread.id === state.selectedThreadId || thread.id === state.threadId;
  const runtime = getThreadRuntime(state.threadRuntimes, thread.id, false);
  const indicator = runtimeIndicator(runtime);
  const itemTitle = `${threadTitle(thread, 500)}\n${thread.cwd || thread.id}`;
  item.dataset.threadId = thread.id;
  item.classList.toggle("active", active);
  item.title = itemTitle;
  parts.button.disabled = !canBeginThreadSelection(state.selectionPending);
  parts.button.title = itemTitle;
  parts.button.setAttribute("aria-current", String(active));
  parts.title.textContent = threadTitle(thread);
  parts.timeText.textContent = formatThreadTime(thread);
  parts.stateMark.className = `thread-item-runtime${indicator.running ? " running" : ""}${indicator.unread ? " unread" : ""}`;
  parts.stateMark.setAttribute("aria-label", indicator.unread
    ? `${indicator.label}; ${indicator.unreadCount || 1} unread update${indicator.unreadCount === 1 ? "" : "s"}`
    : indicator.label);
  parts.stateMark.title = parts.stateMark.getAttribute("aria-label");
  parts.cwd.textContent = compactThreadCwd(thread.cwd) || "Unknown directory";
  parts.cwd.title = thread.cwd || "Working directory unavailable";
  parts.deleteButton.setAttribute("aria-label", `Delete ${threadTitle(thread)}`);
  parts.deleteButton.disabled = state.deletingThreadIds.has(thread.id) || isThreadRuntimeBusy(runtime);
  parts.deleteButton.setAttribute("aria-busy", String(state.deletingThreadIds.has(thread.id)));
}

function renderThreadListNow() {
  const filtered = filterThreads(state.threads, threadSearchInput.value);
  const groups = groupThreads(filtered);
  const structureKey = threadListStructureKey(groups);
  const structureChanged = state.threadListStructureKey !== structureKey;

  if (!filtered.length) {
    state.threadListStructureKey = structureKey;
    state.threadRowNodes.clear();
    threadList.replaceChildren();
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
  } else if (structureChanged || !threadList.children.length) {
    state.threadListStructureKey = structureKey;
    const nextRows = new Map();
    threadList.replaceChildren();
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "thread-group";
      const heading = document.createElement("h3");
      heading.className = "thread-group-title";
      heading.textContent = group.label;
      section.append(heading);
      for (const thread of group.threads) {
        const row = state.threadRowNodes.get(thread.id) || createThreadRow(thread);
        patchThreadRow(row, thread);
        nextRows.set(thread.id, row);
        section.append(row);
      }
      threadList.append(section);
    }
    state.threadRowNodes = nextRows;
  } else {
    for (const thread of filtered) {
      const row = state.threadRowNodes.get(thread.id);
      if (row) patchThreadRow(row, thread);
    }
  }

  threadListStatus.textContent = state.threadListError
    ? "thread/list unavailable"
    : state.threadListLoading
      ? "Refreshing..."
      : `${state.threads.length} recent`;
  loadMoreThreadsButton.classList.toggle("hidden", !state.threadListCursor);
}

const threadListScheduler = createKeyedFrameScheduler(() => renderThreadListNow());

function renderThreadList(key = "state") {
  threadListScheduler.schedule(key);
}

function syncThreadListControls() {
  for (const button of threadList.querySelectorAll(".thread-item-main")) {
    const item = button.closest(".thread-item");
    const threadId = item?.dataset.threadId || "";
    const active = threadId === state.selectedThreadId || threadId === state.threadId;
    button.disabled = !canBeginThreadSelection(state.selectionPending);
    item?.classList.toggle("active", active);
    button.setAttribute("aria-current", String(active));
    const deleteButton = item?.querySelector(".thread-item-delete");
    if (deleteButton) {
      const runtime = getThreadRuntime(state.threadRuntimes, threadId, false);
      deleteButton.disabled = state.deletingThreadIds.has(threadId)
        || isThreadRuntimeBusy(runtime);
      deleteButton.setAttribute("aria-busy", String(state.deletingThreadIds.has(threadId)));
    }
  }
}

function applyThreadList(result, append = false, error = null) {
  state.threadListLoading = false;
  state.threadListError = error
    ? (typeof error === "string" ? error : error.message || error.error?.message || "Recent sessions are unavailable.")
    : null;
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
  if (!force && (state.historyRestoring || state.historyObserverMuted)) return;
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

function addSystemMessage(text, kind = "info", options = {}) {
  state.conversationOrder.push({ kind: "barrier", turnId: state.activeTurnId ?? null });
  const node = document.createElement("div");
  node.className = `system-message system-${kind}`;
  node.textContent = text;
  chat.append(node);
  registerConversationNode(node, {
    sequence: options.sequence ?? fallbackConversationSequence(),
    key: options.key || null,
    turnId: options.turnId ?? state.activeTurnId ?? null,
  });
  scrollToBottom();
}

function addProcessError(item, turnId = state.activeTurnId) {
  const message = item?.message || item?.error?.message || item?.errorMessage || item?.text || "Codex error";
  const process = ensureProcessDetails(turnId, chat, {
    itemId: item?.id,
    sequence: item?.id ? protocolSequenceForItem(item.id) : null,
  });
  const node = document.createElement("div");
  node.className = "process-error";
  if (item?.id) node.dataset.itemId = String(item.id);
  node.textContent = message;
  node.title = message;
  process.body.append(node);
  if (item?.id) {
    process.itemIds.add(item.id);
    process.items?.set(item.id, { ...item, type: "error", message });
  }
  registerConversationNode(node, {
    sequence: item?.id ? protocolSequenceForItem(item.id) : null,
    key: item?.id ? `item:${item.id}` : null,
    turnId,
  });
  updateProcessSummary(process);
  scrollToBottom();
  return node;
}

function renderMarkdown(node, raw, { preserveLineBreaks = false, progressiveMath = false } = {}) {
  const extracted = extractMath(raw || "");
  const html = marked.parse(extracted.markdown, preserveLineBreaks ? { breaks: true } : undefined);
  node.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-codex-math"],
  });
  const mathJob = progressiveMath
    ? scheduleMathSlots(node, extracted.formulas, katex, mathRenderCache, { frameBudgetMs: 6 })
    : (renderMathSlots(node, extracted.formulas, katex, mathRenderCache), null);
  for (const codeBlock of enhanceMarkdownCodeBlocks(node)) renderIcons(codeBlock);
  return mathJob;
}

function clearStreamingTail(record) {
  record.mathRenderJob?.cancel?.();
  record.mathRenderJob = null;
  for (const node of record.streamTailNodes || []) node.remove();
  record.streamTailNodes = [];
}

function processDetailsShouldExpand({ persisted = false, running = false, snapshot = false, turnId = null, activeTurnId = null } = {}) {
  if (persisted) return true;
  if (!running || snapshot) return false;
  return !turnId || !activeTurnId || turnId === activeTurnId;
}

function setProcessDetailsExpanded(record, expanded) {
  if (!record?.body || !record?.summary || !record?.details) return false;
  const next = Boolean(expanded);
  const changed = record.body.hidden !== !next;
  record.body.hidden = !next;
  record.summary.setAttribute("aria-expanded", String(next));
  record.details.classList.toggle("expanded", next);
  return changed;
}

function processBaseKey(turnId = state.activeTurnId) {
  return `${state.threadId || "thread"}:${turnId || "turn"}`;
}

function processKey(turnId = state.activeTurnId) {
  const base = processBaseKey(turnId);
  const epoch = Number(state.processEpochs.get(base)) || 0;
  return epoch ? `${base}:segment:${epoch}` : base;
}

function advanceProcessSegment(turnId = state.activeTurnId) {
  const base = processBaseKey(turnId);
  const currentKey = processKey(turnId);
  const current = state.processNodes.get(currentKey);
  if (!current || (!current.itemIds?.size && !current.body?.childElementCount)) return currentKey;
  const nextEpoch = (Number(state.processEpochs.get(base)) || 0) + 1;
  state.processEpochs.set(base, nextEpoch);
  return processKey(turnId);
}

function splitProcessAtSequence(turnId, sequence) {
  const boundary = optionalConversationSequence(sequence);
  if (boundary === null) return false;
  const current = state.processNodes.get(processKey(turnId));
  if (!current?.body) return false;
  const trailing = [...current.body.children].filter((node) => {
    const value = optionalConversationSequence(state.conversationNodeMeta.get(node)?.sequence);
    return value !== null && value > boundary;
  });
  if (!trailing.length) return false;

  advanceProcessSegment(turnId);
  const next = ensureProcessDetails(turnId, chat, {
    sequence: optionalConversationSequence(state.conversationNodeMeta.get(trailing[0])?.sequence),
  });
  for (const node of trailing) {
    const itemId = node.dataset?.itemId || node.dataset?.messageId;
    const record = itemId
      ? state.toolNodes.get(itemId) || state.activityNodes.get(itemId)
        || state.searchNodes.get(itemId) || state.messageNodes.get(itemId)
      : null;
    current.body.removeChild(node);
    next.body.append(node);
    if (!itemId) continue;
    current.itemIds.delete(itemId);
    current.items?.delete(itemId);
    next.itemIds.add(itemId);
    next.items?.set(itemId, record?.item || { id: itemId });
    if (record) record.process = next;
  }
  updateProcessSummary(current);
  updateProcessSummary(next);
  return true;
}

function updateProcessSummary(record) {
  if (!record) return;
  const items = [...record.itemIds].map((id) => state.toolNodes.get(id)?.item || record.items?.get(id)).filter(Boolean);
  for (const message of state.messageNodes.values()) {
    if (message.process === record && !items.some((item) => item.id === message.id)) {
      items.push({ id: message.id, type: "agentMessage", role: "assistant", text: message.raw });
    }
  }
  const activityCounts = summarizeProcessActivities(items);
  let messageCount = 0;
  for (const id of record.itemIds) {
    const message = state.messageNodes.get(id);
    if (message && (message.raw || message.role === "assistant")) messageCount += 1;
    else if (isDisplayableProcessItem(record.items?.get(id))) messageCount += 1;
  }
  const parts = [`Process details`];
  if (messageCount) parts.push(`${messageCount} message${messageCount === 1 ? "" : "s"}`);
  const labels = [
    ["commands", "command", "commands"],
    ["actions", "parsed action", "parsed actions"],
    ["fileChanges", "file change", "file changes"],
    ["mcp", "MCP", "MCP"],
    ["dynamicTools", "dynamic tool", "dynamic tools"],
    ["agents", "agent", "agents"],
    ["webSearch", "web search", "web searches"],
    ["imageViews", "image view", "image views"],
    ["compactions", "compaction", "compactions"],
    ["reviews", "review", "reviews"],
  ];
  for (const [key, singular, plural] of labels) {
    const count = Number(activityCounts[key]) || 0;
    if (count) parts.push(`${count} ${count === 1 ? singular : plural}`);
  }
  if (activityCounts.unknown) parts.push(`${activityCounts.unknown} unknown item${activityCounts.unknown === 1 ? "" : "s"}`);
  record.summaryText.textContent = parts.join(" · ");
}

function processSegmentHasContent(record) {
  return Boolean(record?.itemIds?.size || record?.body?.childElementCount);
}

function removeEmptyProcessDetails(record) {
  if (!record || processSegmentHasContent(record)) return false;
  record.details?.remove();
  if (state.processNodes.get(record.key) === record) state.processNodes.delete(record.key);
  state.expandedProcesses.delete(record.key);
  state.conversationNodeMeta.delete(record.details);
  reconcileConversationNodes();
  return true;
}

function collapseProcessDetailsForTurn(turnId) {
  let changed = false;
  let persistenceChanged = false;
  for (const record of state.processNodes.values()) {
    if (turnId && record.turnId !== turnId) continue;
    changed = setProcessDetailsExpanded(record, false) || changed;
    persistenceChanged = state.expandedProcesses.delete(record.key) || persistenceChanged;
  }
  if (persistenceChanged) saveThreadUi();
  return changed;
}

function ensureProcessDetails(turnId = state.activeTurnId, container = chat, options = {}) {
  const key = processKey(turnId);
  let record = state.processNodes.get(key);
  const sequence = options.sequence ?? (options.itemId ? protocolSequenceForItem(options.itemId) : null);
  if (record) {
    registerConversationNode(record.details, {
      sequence,
      key: `process:${key}`,
      turnId,
    });
    return record;
  }
  const details = document.createElement("section");
  details.className = "process-details";
  details.dataset.processKey = key;
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "process-details-toggle";
  summary.setAttribute("aria-expanded", "false");
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("class", "process-details-chevron");
  chevron.setAttribute("width", "12");
  chevron.setAttribute("height", "12");
  chevron.setAttribute("viewBox", "0 0 12 12");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "1.6");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  chevron.setAttribute("aria-hidden", "true");
  const processChevronLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  processChevronLine.setAttribute("points", "4 2.5 7.5 6 4 9.5");
  chevron.append(processChevronLine);
  const summaryText = document.createElement("span");
  summaryText.className = "process-details-text";
  const body = document.createElement("div");
  body.className = "process-details-body";
  body.hidden = true;
  summary.append(chevron, summaryText);
  details.append(summary, body);
  record = { key, turnId, details, summary, summaryText, body, itemIds: new Set(), items: new Map() };
  const expanded = processDetailsShouldExpand({
    persisted: state.expandedProcesses.has(key),
    running: state.running,
    snapshot: isSnapshotMode(),
    turnId,
    activeTurnId: state.activeTurnId || state.currentTurn?.id,
  });
  setProcessDetailsExpanded(record, expanded);
  summary.addEventListener("click", () => {
    const next = body.hidden;
    setProcessDetailsExpanded(record, next);
    if (next) state.expandedProcesses.add(key);
    else state.expandedProcesses.delete(key);
    saveThreadUi();
    scrollToBottom();
  });
  (container || chat).append(details);
  state.processNodes.set(key, record);
  registerConversationNode(details, {
    sequence,
    key: `process:${key}`,
    turnId,
  });
  updateProcessSummary(record);
  return record;
}

function registerProcessItem(item, record = null) {
  if (!item?.id) return record;
  const process = record || ensureProcessDetails(item.turnId || state.activeTurnId, chat, {
    itemId: item.id,
    sequence: protocolSequenceForItem(item.id),
  });
  process.itemIds.add(item.id);
  process.items?.set(item.id, item);
  updateProcessSummary(process);
  return process;
}

function promoteAssistantAnswer(record) {
  const process = record?.process;
  if (!record?.article || !process) return;
  if (record.article.parentElement === process.body) chat.append(record.article);
  registerConversationNode(record.article, {
    sequence: protocolSequenceForItem(record.id),
    key: `item:${record.id}`,
    turnId: record.turnId,
  });
  process.itemIds.delete(record.id);
  process.items?.delete(record.id);
  record.process = null;
  updateProcessSummary(process);
  collapseProcessDetailsForTurn(process.turnId || record.turnId);
  removeEmptyProcessDetails(process);
  scheduleConversationOutlineRender();
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
    record.content.append(node);
    record.streamTailNodes = [node];
    record.mathRenderJob = renderMarkdown(node, tail, { progressiveMath: true });
  }
  record.streamNeedsFinalRender = Boolean(tail);
  record.renderedRaw = raw;
}

function resetStreamingMessage(record, { preserveRenderedTail = false } = {}) {
  if (preserveRenderedTail) {
    record.mathRenderJob = null;
    for (const node of record.streamTailNodes || []) node.classList.remove("streaming-tail");
    record.streamTailNodes = [];
  } else {
    clearStreamingTail(record);
  }
  record.streaming = false;
  record.streamStarted = false;
  record.streamPrefixLength = 0;
  record.streamNeedsFinalRender = false;
}

function renderCompletedMessage(record, raw) {
  const wasStreaming = record.streaming || record.streamStarted;
  record.raw = raw;
  if (wasStreaming) {
    if (record.renderedRaw !== raw || record.streamNeedsFinalRender) renderStreamingMessage(record);
    resetStreamingMessage(record, { preserveRenderedTail: true });
  } else if (record.renderedRaw !== raw) {
    renderMarkdown(record.content, raw);
  }
  record.renderedRaw = raw;
}

function renderUserMessage(record, input) {
  const presentation = presentUserInput(Array.isArray(input) ? input : []);
  record.input = Array.isArray(input) ? input : [];
  record.raw = presentation.displayText;
  if (presentation.text) renderMarkdown(record.content, presentation.text, { preserveLineBreaks: true });
  else record.content.replaceChildren();

  if (presentation.images.length) {
    const images = document.createElement("div");
    images.className = "message-images";
    images.setAttribute("role", "list");
    for (const image of presentation.images) {
      if (image.available) {
        const element = document.createElement("img");
        element.className = "message-image";
        element.src = image.src;
        element.alt = `Attached image ${image.index}`;
        element.loading = "lazy";
        element.decoding = "async";
        element.setAttribute("role", "listitem");
        images.append(element);
      } else {
        const unavailable = document.createElement("span");
        unavailable.className = "message-image-unavailable";
        unavailable.textContent = `[Image #${image.index}]`;
        unavailable.setAttribute("role", "listitem");
        images.append(unavailable);
      }
    }
    record.content.prepend(images);
  }
  record.renderedRaw = record.raw;
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
    scheduleConversationOutlineRender();
    scrollToBottom();
  }, 80);
  state.renderTimers.set(record.id, timer);
}

function ensureMessage(id, role, meta = {}) {
  let record = state.messageNodes.get(id);
  if (record) {
    if (meta.turnId && !record.turnId) record.turnId = meta.turnId;
    if (role === "assistant") {
      const resolved = resolveModelDisplayName({
        message: meta.item,
        turn: meta.turn,
        thread: { model: record.modelId || meta.model || state.threadMeta.model || modelSelect.value },
        models: state.models,
        modelId: record.modelId || meta.model,
      });
      // A metadata refresh may finally provide the display name for the id
      // this message was created with. Never follow a later selector change.
      if (resolved.id && record.modelId === resolved.id && !record.modelResolved && resolved.resolved) {
        record.modelLabel = resolved.label;
        record.modelResolved = true;
        record.label.textContent = resolved.label;
      }
    }
    if (role === "assistant" && meta.process === true && !record.process) {
      const process = ensureProcessDetails(meta.turnId ?? state.activeTurnId ?? record.turnId, chat, {
        itemId: record.id,
        sequence: protocolSequenceForItem(record.id),
      });
      process.body.append(record.article);
      process.itemIds.add(record.id);
      process.items?.set(record.id, { id: record.id, type: "agentMessage", role: "assistant", text: record.raw });
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
  const head = role === "assistant" ? document.createElement("div") : null;
  if (head) head.className = "message-head";
  const label = role === "assistant" ? document.createElement("div") : null;
  if (label) label.className = "message-label";
  const modelInfo = role === "assistant"
    ? resolveModelDisplayName({
        message: meta.item,
        turn: meta.turn,
        thread: { model: meta.model || state.threadMeta.model || modelSelect.value },
        models: state.models,
        modelId: meta.item?.model ?? meta.item?.modelId ?? meta.model,
      })
    : null;
  if (label) {
    label.textContent = modelInfo.label;
    if (modelInfo?.id) label.dataset.modelId = modelInfo.id;
  }
  const time = role === "user" ? document.createElement("time") : null;
  if (time) {
    time.className = "message-time";
    const timestamp = Number(meta.startedAt || state.currentTurn?.startedAt || 0);
    time.textContent = timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000)) : "";
  }
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
  if (role === "assistant") {
    head.append(label, copy);
    article.append(head, content);
  } else {
    const metaRow = document.createElement("div");
    metaRow.className = "message-user-meta";
    metaRow.append(copy, time);
    article.append(content, metaRow);
  }
  const turnId = meta.turnId ?? state.activeTurnId ?? state.currentTurn?.id;
  const process = role === "assistant" && meta.process !== false && (meta.live !== false ? meta.process !== false : meta.process === true)
    ? ensureProcessDetails(turnId, chat, {
      itemId: id,
      sequence: protocolSequenceForItem(id),
    })
    : null;
  (process?.body || chat).append(article);
  registerConversationNode(article, {
    sequence: protocolSequenceForItem(id),
    key: `item:${id}`,
    turnId,
  });
  renderIcons(role === "assistant" ? head : article.querySelector(".message-user-meta"));

  record = {
    id,
    role,
    raw: "",
    renderedRaw: "",
    article,
    content,
    time,
    label,
    modelId: modelInfo?.id || "",
    modelLabel: modelInfo?.label || "Codex",
    modelResolved: Boolean(modelInfo?.resolved),
    streaming: false,
    streamStarted: false,
    streamPrefixLength: 0,
    streamNeedsFinalRender: false,
    streamTailNodes: [],
    mathRenderJob: null,
    process,
    turnId,
  };
  state.messageNodes.set(id, record);
  if (process) {
    process.itemIds.add(id);
    process.items?.set(id, { id, type: role === "assistant" ? "agentMessage" : "userMessage", role });
    updateProcessSummary(process);
  }
  if (meta.live !== false) state.conversationOrder.push({ kind: "barrier", id, turnId: turnId ?? null });
  if (role === "user" && !meta.deferOutline) renderConversationOutline();
  return record;
}

function addLocalUserMessage(input) {
  const id = `local-user-${crypto.randomUUID()}`;
  const record = ensureMessage(id, "user");
  const content = Array.isArray(input) ? input : [{ type: "text", text: String(input || "") }];
  renderUserMessage(record, content);
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

function activityItemLabel(item) {
  const type = item?.type || "unknown";
  if (["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(type)) {
    return presentAgentActivity(item).label;
  }
  if (type === "dynamicToolCall") return item.tool || item.name || "Dynamic tool";
  if (type === "imageView") return "View image";
  if (type === "imageGeneration") return "Generate image";
  if (type === "contextCompaction") return "Context compaction";
  if (["enteredReviewMode", "exitedReviewMode", "review"].includes(type)) return "Code review";
  if (["hookPrompt", "sleep"].includes(type)) return type === "sleep" ? "Waiting" : "Hook";
  if (["reasoning", "thinking"].includes(type)) return "Thinking";
  return `Unknown App Server item · ${type}`;
}

function activityItemPreview(item) {
  if (["reasoning", "thinking"].includes(item?.type)) return "";
  const reasoningPreview = reasoningText(item, " ");
  const value = ["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(item?.type)
    ? agentActivityName(item)
    : item?.tool || item?.path || item?.url || item?.savedPath || item?.description || item?.result || item?.text || item?.message || reasoningPreview;
  return typeof value === "string" ? value : toolCopyText(value);
}

function activityItemBody(item) {
  const reasoningBody = reasoningText(item);
  const fields = [
    ["Type", item?.type],
    ["Agent", ["collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus"].includes(item?.type) ? agentActivityName(item) : item?.agentName || item?.agent || item?.name],
    ["Thread", item?.threadId || item?.agentThreadId],
    ["Status", item?.status || item?.state],
    ["Kind", item?.kind],
    ["Agents", item?.agentsStates],
    ["Input", item?.input || item?.arguments || item?.params],
    ["Output", item?.output || item?.result || item?.text || item?.message || item?.savedPath || reasoningBody],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  return fields.map(([label, value]) => `${label}: ${typeof value === "string" ? value : toolCopyText(value)}`).join("\n\n");
}

function ensureActivityItem(item, options = {}) {
  if (!item?.id) return null;
  let record = state.activityNodes.get(item.id);
  if (!record) {
    const process = options.process === true || (options.process !== false && options.live !== false)
      ? ensureProcessDetails(options.turnId ?? item.turnId ?? state.activeTurnId, chat, {
        itemId: item.id,
        sequence: protocolSequenceForItem(item.id),
      })
      : null;
    const shell = createPiToolShell(item, "activity", options.container || process?.body || chat);
    record = { kind: "activity", ...shell, item, process, body: shell.body };
    record.copyButton = createPiToolCopyButton(() => activityItemBody(record.item));
    shell.onToggle = (_shell, open) => {
      record.open = open;
      record.body.hidden = !open;
      if (open) patchActivityItem(record, record.item);
    };
    state.activityNodes.set(item.id, record);
    registerConversationNode(record.details, {
      sequence: protocolSequenceForItem(item.id),
      key: `item:${item.id}`,
      turnId: options.turnId ?? item.turnId ?? state.activeTurnId,
    });
    if (process) registerProcessItem(item, process);
  }
  patchActivityItem(record, item);
  return record;
}

function patchActivityItem(record, item) {
  if (!record) return;
  record.item = item;
  const status = normalizeToolStatus(item?.status || item?.state || item?.result || item?.kind);
  const waiting = status.kind === "waiting";
  record.details.dataset.status = waiting ? "running" : status.kind;
  record.type.textContent = activityItemLabel(item);
  const preview = activityItemPreview(item);
  record.preview.textContent = preview;
  record.preview.title = preview;
  record.status.textContent = "";
  record.status.dataset.kind = waiting ? "waiting" : status.kind;
  record.status.setAttribute("aria-label", waiting ? "Waiting" : status.label);
  record.duration.textContent = toolDurationLabel(item?.durationMs);
  record.body.replaceChildren();
  const body = document.createElement("pre");
  body.className = "process-activity-body";
  body.textContent = activityItemBody(item);
  record.body.append(body, record.copyButton);
  updateProcessSummary(record.process);
}

function searchQuery(item) {
  const action = item?.action;
  const queries = Array.isArray(action?.queries) ? action.queries : [];
  const value = item?.query || action?.query || queries[0] || "";
  return typeof value === "string" ? value : toolCopyText(value);
}

function searchStepTitle(item, isActive) {
  if (item?.type === "webSearch") return isActive ? "Searching web..." : "Web search";
  return isActive ? "Searching files..." : "File search";
}

function searchResultText(item) {
  const value = item?.results ?? item?.result ?? item?.output ?? item?.response ?? item?.aggregatedOutput;
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  return toolCopyText(value);
}

function toolCopyText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value, (key, nested) => {
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
      return Object.fromEntries(Object.keys(nested).sort().map((name) => [name, nested[name]]));
    }, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return "[unserializable value]";
  }
}

function toolCopySection(label, value) {
  const text = toolCopyText(value);
  return text ? `${label}:\n${text}` : "";
}

function commandCopyText(record) {
  const item = record?.item || {};
  const model = record?.presentation || presentCommand(item);
  const terminalInput = Array.isArray(item.terminalInteractions)
    ? item.terminalInteractions.map((entry) => entry?.stdin || "").filter(Boolean).join("\n")
    : "";
  const sections = [
    toolCopySection("Command", item.command ?? item.commandLine ?? item.rawCommand ?? model.rawCommand),
    toolCopySection("Output", item.aggregatedOutput),
    toolCopySection("Terminal input", terminalInput),
    toolCopySection("stdout", item.stdout),
    toolCopySection("stderr", item.stderr),
    toolCopySection("Error", item.errorMessage ?? item.error),
  ].filter(Boolean);
  return sections.join("\n\n") || toolCopyText(item);
}

function searchCopyText(record) {
  const sections = [
    toolCopySection("Query", record?.rawQuery || "(empty query)"),
    toolCopySection("Results", record?.resultText),
  ].filter(Boolean);
  return sections.join("\n\n") || toolCopyText(record?.item || {});
}

function mcpCopyText(item) {
  const input = item?.arguments ?? item?.params ?? item?.parameters ?? item?.input;
  const result = item?.result ?? item?.output ?? item?.response;
  const error = item?.error ?? item?.errorMessage ?? item?.failureReason;
  const sections = [
    toolCopySection("Server", item?.server),
    toolCopySection("Tool", item?.tool),
    toolCopySection("Params", input),
    toolCopySection("Result", result),
    toolCopySection("Error", error),
  ].filter(Boolean);
  return sections.join("\n\n") || toolCopyText(item || {});
}

function fileChangeCopyText(item, files = normalizeFileChanges(item)) {
  const sections = (Array.isArray(files) ? files : []).map((file) => [
    toolCopySection("Path", file?.path),
    toolCopySection("Diff", file?.diff),
  ].filter(Boolean).join("\n")).filter(Boolean);
  return sections.join("\n\n") || toolCopyText(item || {});
}

function renderSearchDetails(record) {
  if (!record.open) {
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
  record.body.append(record.copyButton);
}

function updateSearchStep(item, options = {}) {
  if (!item?.id || item.type !== "webSearch") return null;
  let record = state.searchNodes.get(item.id);
  if (!record) {
    const process = options.process === true || options.live !== false
      ? ensureProcessDetails(options.turnId || item.turnId || state.activeTurnId, chat, {
        itemId: item.id,
        sequence: protocolSequenceForItem(item.id),
      })
      : null;
    const target = options.container || process?.body || chat;
    const shell = createPiToolShell(item, "search", target);
    record = {
      kind: "search",
      ...shell,
      card: shell.details,
      tool: shell.type,
      title: shell.type,
      query: shell.preview,
      item,
      process,
      rawQuery: "",
      resultText: "",
    };
    record.copyButton = createPiToolCopyButton(() => searchCopyText(record));
    shell.onToggle = () => renderSearchDetails(record);
    state.searchNodes.set(item.id, record);
    registerConversationNode(record.details, {
      sequence: protocolSequenceForItem(item.id),
      key: `item:${item.id}`,
      turnId: options.turnId || item.turnId || state.activeTurnId,
    });
    if (process) registerProcessItem(item, process);
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
  record.query.textContent = toolInputPreview(item, { maxLength: 120 }) || "";
  record.query.title = query || "(empty query)";
  record.duration.textContent = toolDurationLabel(durationMs);
  record.status.textContent = "";
  record.status.setAttribute("aria-label", normalizedStatus.label);
  record.status.dataset.label = normalizedStatus.label;
  record.status.dataset.kind = normalizedStatus.kind;
  record.statusLabel = normalizedStatus.label;
  if (record.open) renderSearchDetails(record);
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
  record.open = expanded;
  record.summary.setAttribute("aria-expanded", String(expanded));
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
      if (Number.isFinite(duration)) record.duration.textContent = toolDurationLabel(duration);
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
    const startedAt = timestampToMs(item?.startedAtMs ?? item?.startedAt);
    if (!state.commandObservedStartMs.has(item.id)) state.commandObservedStartMs.set(item.id, startedAt ?? Date.now());
    ensureCommandDurationTimer();
  } else if (state.commandObservedStartMs.has(item.id)) {
    record.finishedAtMs ||= timestampToMs(item?.completedAtMs ?? item?.completedAt) ?? Date.now();
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

function createPiToolCopyButton(getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pi-tool-copy text-button";
  button.title = "Copy tool details";
  button.setAttribute("aria-label", "Copy tool details");
  const icon = document.createElement("i");
  icon.dataset.icon = "copy";
  const label = document.createElement("span");
  label.textContent = "Copy";
  button.append(icon, label);
  renderIcons(button);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    let value = "";
    try { value = getText?.() ?? ""; } catch { value = "[unserializable value]"; }
    copyField(String(value));
  });
  return button;
}

function createToolChevron(className = "pi-tool-chevron") {
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("class", className);
  chevron.setAttribute("width", "10");
  chevron.setAttribute("height", "10");
  chevron.setAttribute("viewBox", "0 0 10 10");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "1.6");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  chevron.setAttribute("aria-hidden", "true");
  const toolChevronLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  toolChevronLine.setAttribute("points", "2 3.5 5 6.5 8 3.5");
  chevron.append(toolChevronLine);
  return chevron;
}

/** Shared Pi-style shell used by every expandable tool row. */
function createPiToolShell(item, kind, container, onToggle) {
  const details = document.createElement("section");
  details.className = `pi-tool-step ${kind}-step`;
  details.dataset.itemId = item.id;
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = `pi-tool-step-toggle ${kind}-step-summary`;
  summary.setAttribute("aria-expanded", "false");
  const type = document.createElement("span");
  type.className = `pi-tool-type ${kind}-step-tool ${kind}-step-title`;
  const preview = document.createElement("span");
  preview.className = `pi-tool-preview ${kind}-step-preview ${kind}-step-query`;
  const duration = document.createElement("span");
  duration.className = "pi-tool-duration command-step-duration";
  const status = document.createElement("span");
  status.className = "pi-tool-status command-step-status";
  status.setAttribute("role", "status");
  const chevron = createToolChevron();
  summary.append(type, preview, duration, status, chevron);
  const body = document.createElement("div");
  body.className = `pi-tool-step-body ${kind}-step-body`;
  body.hidden = true;
  details.append(summary, body);
  const record = { details, summary, type, preview, duration, status, chevron, body, item, open: false };
  summary.addEventListener("click", () => {
    record.open = !record.open;
    body.hidden = !record.open;
    summary.setAttribute("aria-expanded", String(record.open));
    details.classList.toggle("expanded", record.open);
    record.onToggle?.(record, record.open);
    scrollToBottom();
  });
  if (container) container.append(details);
  return record;
}

function createCommandStep(item, container = chat) {
  const shell = createPiToolShell(item, "command", container);
  const { details, summary, type: environment, preview: summaryText, status, duration, chevron, body } = shell;

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
  const record = {
    kind: "command",
    ...shell,
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
    linkedFilePath: null,
  };
  summaryText.addEventListener("click", (event) => {
    if (!record.linkedFilePath) return;
    event.preventDefault();
    event.stopPropagation();
    openFileInPanel(record.linkedFilePath);
  });
  record.copyButton = createPiToolCopyButton(() => commandCopyText(record));
  body.append(record.copyButton);
  shell.onToggle = (ignoredShell, open) => {
    setCommandPersistence(record, open);
    if (open) patchCommandStep(record, record.item);
  };
  const expanded = commandDefaultOpen(item) && !state.collapsedCommands.has(item.id) || state.expandedCommands.has(item.id);
  record.open = expanded;
  body.hidden = !expanded;
  summary.setAttribute("aria-expanded", String(expanded));
  details.classList.toggle("expanded", expanded);
  outputDetails.open = state.expandedCommandOutputs.has(item.id);
  outputDetails.addEventListener("toggle", () => {
    if (outputDetails.open) state.expandedCommandOutputs.add(item.id);
    else state.expandedCommandOutputs.delete(item.id);
    if (outputDetails.open) fullOutput.textContent = record.item?.aggregatedOutput || "";
    saveThreadUi();
  });
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
  record.summaryText.textContent = model.inputPreview || model.rawCommand || "";
  record.summaryText.title = model.rawCommand || model.inputPreview || "Tool input";
  record.linkedFilePath = model.category === "read"
    ? resolveFileLink(model.inputPreview || "")
    : null;
  record.summaryText.classList.toggle("file-path-link", Boolean(record.linkedFilePath));
  const displayToolName = item.type === "commandExecution"
    ? (model.explorationEligible ? "Explored" : model.toolName)
    : item.toolName || model.toolName || (item.type === "read" ? "read" : item.type === "webSearch" ? "web_search" : "bash");
  record.environment.textContent = displayToolName;
  record.status.textContent = "";
  record.status.setAttribute("aria-label", model.normalizedStatus.label);
  record.status.dataset.label = model.normalizedStatus.label;
  record.status.dataset.kind = model.normalizedStatus.kind;
  const interactionCount = Array.isArray(item.terminalInteractions) ? item.terminalInteractions.length : 0;
  record.statusDetail.textContent = `Status: ${model.normalizedStatus.label}${model.actionSummary ? ` · ${model.actionSummary}` : ""}${interactionCount ? ` · ${interactionCount} terminal input${interactionCount === 1 ? "" : "s"}` : ""}`;
  record.duration.textContent = toolDurationLabel(durationMs);
  record.cwd.textContent = item.cwd ? `cwd: ${item.cwd}` : "";
  record.cwd.title = item.cwd || "Working directory unavailable";
  record.exit.textContent = item.exitCode === null || item.exitCode === undefined ? "" : `exit: ${item.exitCode}`;
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
    record.open = false;
    record.body.hidden = true;
    record.summary.setAttribute("aria-expanded", "false");
    record.details.classList.remove("expanded");
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
  const shell = createPiToolShell(item, "mcp", container);
  const { details, summary, type: environment, preview: title, status, duration, chevron, body } = shell;
  const record = { kind: "mcp", ...shell, details, summary, title, environment, status, duration, body, item };
  record.copyButton = createPiToolCopyButton(() => mcpCopyText(record.item));
  shell.onToggle = (ignoredShell, open) => setMcpPersistence(record, open);
  const expanded = commandDefaultOpen(item) || state.expandedMcpTools.has(item.id);
  record.open = expanded;
  body.hidden = !expanded;
  summary.setAttribute("aria-expanded", String(expanded));
  details.classList.toggle("expanded", expanded);
  patchMcpStep(record, item);
  return record;
}

function patchMcpStep(record, item) {
  record.item = item;
  const normalizedStatus = normalizeToolStatus(item.status);
  record.details.dataset.status = normalizedStatus.kind;
  const model = presentTool(item, { maxLength: 180 });
  record.environment.textContent = item.tool || "mcp";
  record.title.textContent = model.inputPreview || "";
  record.title.title = model.rawInput || "MCP input";
  record.status.textContent = "";
  record.status.setAttribute("aria-label", normalizedStatus.label);
  record.status.dataset.label = normalizedStatus.label;
  record.status.dataset.kind = normalizedStatus.kind;
  record.duration.textContent = toolDurationLabel(item.durationMs);
  record.body.replaceChildren();
  const meta = document.createElement("div");
  meta.className = "mcp-step-meta";
  if (item.server) appendCommandField(meta, "server", item.server, "mcp-step-field");
  if (item.tool) appendCommandField(meta, "tool", item.tool, "mcp-step-field");
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
  if (item.progress) appendCommandField(record.body, "Progress", item.progress, "mcp-step-field");
  record.body.append(record.copyButton);
  updateProcessSummary(record.process);
}

function registerConversationTool(record, options = {}) {
  if (options.live === false || record.orderEntry) return;
  const previous = state.conversationOrder.at(-1);
  const protocolSequence = protocolSequenceForItem(record.item?.id);
  record.orderEntry = {
    kind: "tool",
    record,
    turnId: options.turnId ?? state.activeTurnId ?? record.item?.turnId ?? null,
    previousItemId: previous?.record?.item?.id || previous?.id || null,
    sequence: state.toolCacheSequence++,
    protocolSequence,
  };
  state.conversationOrder.push(record.orderEntry);
  if (record.process?.details) {
    registerConversationNode(record.process.details, {
      sequence: protocolSequence,
      key: `process:${record.process.key}`,
      turnId: record.orderEntry.turnId,
    });
  }
}

function attachExplorationGroup(record) {
  if (!record?.process || record.kind !== "command" || !record.presentation?.explorationEligible) return;
  const details = record.details;
  details.classList.add("exploration-command");
  if (details.parentElement?.classList.contains("exploration-group")) return;
  const previous = details.previousElementSibling;
  if (previous?.classList.contains("exploration-group")) {
    previous.append(details);
    return;
  }
  if (!previous?.classList.contains("exploration-command")) return;
  if (previous.parentElement?.classList.contains("exploration-group")) {
    previous.parentElement.append(details);
    return;
  }
  const group = document.createElement("section");
  group.className = "exploration-group";
  const heading = document.createElement("div");
  heading.className = "exploration-group-heading";
  heading.textContent = "Explored";
  previous.replaceWith(group);
  group.append(heading, previous, details);
}

function ensureTool(item, options = {}) {
  let record = state.toolNodes.get(item.id);
  if (record) return record;
  const process = options.process === true || (options.process !== false && options.live !== false)
    ? ensureProcessDetails(options.turnId ?? item.turnId ?? state.activeTurnId, chat, {
      itemId: item.id,
      sequence: protocolSequenceForItem(item.id),
    })
    : null;
  const targetContainer = options.container || process?.body || chat;
  if (item.type === "fileChange") {
    const shell = createPiToolShell(item, "file", targetContainer);
    shell.details.classList.add("file-change-card");
    record = { kind: "fileChange", ...shell, details: shell.details, summary: shell.summary, body: shell.body, item, fileList: null, normalizedFiles: null, process };
    record.copyButton = createPiToolCopyButton(() => fileChangeCopyText(record.item, record.normalizedFiles));
    shell.onToggle = (ignoredShell, open) => {
      const currentItem = record.item || item;
      setFileChangeExpanded(record, currentItem, open);
      renderToolFileChange(record, currentItem);
    };
    const expanded = state.expandedFileChanges.has(item.id);
    record.open = expanded;
    record.body.hidden = !expanded;
    record.summary.setAttribute("aria-expanded", String(expanded));
    state.toolNodes.set(item.id, record);
    registerConversationNode(record.details, {
      sequence: protocolSequenceForItem(item.id),
      key: `item:${item.id}`,
      turnId: options.turnId ?? item.turnId ?? state.activeTurnId,
    });
    if (process) registerProcessItem(item, process);
    registerConversationTool(record, options);
    renderToolFileChange(record, item);
    return record;
  }
  if (item.type === "mcpToolCall") record = createMcpStep(item, targetContainer);
  else record = createCommandStep(item, targetContainer);
  record.process = process;
  state.toolNodes.set(item.id, record);
  registerConversationNode(record.details, {
    sequence: protocolSequenceForItem(item.id),
    key: `item:${item.id}`,
    turnId: options.turnId ?? item.turnId ?? state.activeTurnId,
  });
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
  record.open = expanded;
  record.type.textContent = "edit";
  const preview = files[0]?.path || (files.length ? fileChangeLabel(files.length) : "");
  record.preview.textContent = preview;
  record.preview.title = files.map((file) => file.path).filter(Boolean).join("\n") || fileChangeLabel(files.length);
  record.duration.textContent = toolDurationLabel(item.durationMs);
  record.status.textContent = "";
  record.status.dataset.kind = normalizedStatus.kind;
  record.status.setAttribute("aria-label", normalizedStatus.label);
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
    record.body.append(empty, record.copyButton);
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
    const linkedPath = resolveFileLink(path.full || path.relative);
    if (linkedPath) {
      titleWrap.classList.add("file-path-link");
      titleWrap.setAttribute("role", "button");
      titleWrap.setAttribute("tabindex", "0");
      const openChangedFile = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFileInPanel(linkedPath);
      };
      titleWrap.addEventListener("click", openChangedFile);
      titleWrap.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openChangedFile(event);
      });
    }
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
  record.body.append(fileList, record.copyButton);
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
    attachExplorationGroup(record);
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

function toolDurationLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "";
  return `${Math.round(ms / 1000)}s`;
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

function renderPlanCard(snapshot, { text = "", key = null, live = true, itemId = null, sequence = null } = {}) {
  const resolvedKey = key || planSnapshotKey(snapshot?.threadId || state.threadId, snapshot?.turnId || state.activeTurnId);
  const planTurnId = snapshot?.turnId || state.activeTurnId || null;
  const resolvedSequence = sequence ?? protocolSequenceForPlan(resolvedKey) ?? protocolSequenceForItem(itemId);
  let record = state.planNodes.get(resolvedKey);
  if (!record) {
    // Close the current process segment before placing a plan. Items that
    // arrive after this update then receive a fresh segment after the card.
    if (!splitProcessAtSequence(planTurnId, resolvedSequence)) advanceProcessSegment(planTurnId);
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
    $("#chatEmptyState")?.remove();
    chat.append(card);
    renderIcons(card);
    record = {
      card,
      turn,
      explanation,
      body,
      actions,
      implement,
      text: "",
      key: resolvedKey,
      live,
      turnId: planTurnId,
      orderSequence: resolvedSequence,
      processBoundaryApplied: true,
    };
    state.planNodes.set(resolvedKey, record);
    state.conversationOrder.push({ kind: "barrier", turnId: planTurnId, planKey: resolvedKey });
    registerConversationNode(card, {
      sequence: record.orderSequence,
      key: `plan:${resolvedKey}`,
      turnId: planTurnId,
    });
  } else if (optionalConversationSequence(resolvedSequence) !== null && !record.processBoundaryApplied) {
    splitProcessAtSequence(record.turnId || planTurnId, resolvedSequence);
    record.processBoundaryApplied = true;
  }
  if (record.card.parentElement === chat) {
    registerConversationNode(record.card, {
      sequence: resolvedSequence,
      key: `plan:${resolvedKey}`,
      turnId: record.turnId || planTurnId,
    });
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
  state.protocolState = reduceProtocolState(state.protocolState, {
    method: "turn/plan/updated",
    params,
  });
  saveProtocolState();
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
  const requestThreadId = request.threadId || params.threadId || state.threadId;
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
      if (!requireWritable("approve a tool request")) return;
      if (!send({ type: "approval", threadId: requestThreadId, requestId: id, decision })) return;
      state.pendingServerRequests.delete(String(id));
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
  if (state.running) syncActivityFromProtocol();
}

function clearUserInputRequest() {
  if (state.userInputRequest?.requestId !== undefined) {
    state.pendingServerRequests.delete(String(state.userInputRequest.requestId));
  }
  state.userInputRequest = resetUserInputRequest(state.userInputRequest);
  approvalArea.querySelector(".user-input-card")?.remove();
  approvalArea.classList.remove("has-user-input");
  renderApprovalQueue();
  if (state.running) syncActivityFromProtocol();
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
    if (send({ type: "serverRequestResponse", threadId: message.params?.threadId || state.threadId, requestId: message.id, result: { answers: {} } })) {
      state.pendingServerRequests.delete(String(message.id));
      addSystemMessage("Questions 0/0 answered.");
    }
    return;
  }
  clearUserInputRequest();
  if (isNotificationForThread(message.params, state.threadId)) {
    state.activeTurnId = message.params?.turnId || state.activeTurnId;
  }
  state.running = true;
  state.threadStatus = "active";
  setTurnActivityWorking(null, "Waiting for your input");
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
  if (!requireWritable("answer tool questions")) return;
  const result = buildUserInputResult(request.questions, request.answers);
  if (!result) return;
  if (!send({ type: "serverRequestResponse", threadId: request.threadId || state.threadId, requestId: request.requestId, result })) return;
  const total = request.questions.length;
  clearUserInputRequest();
  addSystemMessage(`Questions ${total}/${total} answered.`);
  updateControls();
}

function addApproval(message) {
  state.approvals = enqueueApproval(state.approvals, message);
  if (state.running || state.activeTurnId) setTurnActivityWorking(null, "Approval required");
  renderApprovalQueue();
}

function renderHistoricalBlock(block) {
  if (block.type === "message") {
    const item = block.item;
    const record = ensureMessage(item.id, block.role, {
      startedAt: item.startedAt,
      item,
      model: item.model,
      deferOutline: true,
      live: false,
      process: block.role === "assistant" && !state.historicalProcessAnswerIds.has(item.id),
      turnId: block.turnId,
    });
    resetStreamingMessage(record);
    if (block.role === "user") renderUserMessage(record, item.content || []);
    else {
      record.raw = item.text || "";
      renderMarkdown(record.content, record.raw);
      record.renderedRaw = record.raw;
    }
    return;
  }
  if (block.type === "command") {
    updateTool(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "search") {
    updateSearchStep(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "fileChange" || block.type === "mcpTool") {
    updateTool(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (["dynamicTool", "agent", "imageView", "compaction", "review", "reasoning", "unknown"].includes(block.type)) {
    ensureActivityItem(block.item, { live: false, process: true, turnId: block.turnId });
  } else if (block.type === "error") {
    addProcessError(block.item, block.turnId);
  } else if (block.type === "plan") {
    const item = block.item || {};
    const key = planSnapshotKey(state.threadId, block.turnId || item.turnId || item.id);
    const storedSnapshot = state.planSnapshots.get(key);
    const snapshot = {
      threadId: state.threadId,
      turnId: block.turnId,
      explanation: null,
      steps: [],
    };
    renderPlanCard(snapshot, {
      key,
      text: item.planText || item.text || "",
      live: false,
      itemId: item.id,
    });
    if (storedSnapshot) {
      renderPlanCard(storedSnapshot, {
        key,
        text: item.planText || item.text || "",
        live: false,
        itemId: item.id,
      });
    }
  } else if (block.type === "status") {
    const text = block.item.text || block.item.message;
    if (text) addSystemMessage(text);
  }
}

function protocolEventNode(entry) {
  if (!entry) return null;
  if (entry.kind === "plan" && entry.planKey) return state.planNodes.get(entry.planKey)?.card || null;
  if (!entry.itemId) return null;
  const record = state.toolNodes.get(entry.itemId) || state.activityNodes.get(entry.itemId);
  if (record?.details) return record.process?.details || record.details;
  const message = state.messageNodes.get(entry.itemId);
  return message?.process?.details || message?.article || null;
}

function restoreProtocolEventOrder() {
  const entries = [...(state.protocolState?.orderedEvents || [])]
    .filter((entry) => optionalConversationSequence(entry.sequence) !== null)
    .sort((left, right) => optionalConversationSequence(left.sequence) - optionalConversationSequence(right.sequence));
  for (const entry of entries) {
    const node = protocolEventNode(entry);
    if (!node) continue;
    const historyKey = entry.kind === "plan"
      ? `plan:${entry.planKey || ""}`
      : `item:${entry.itemId || ""}`;
    const sequence = Number(state.historyOrderRanks.get(historyKey));
    registerConversationNode(node, {
      sequence: Number.isFinite(sequence) ? sequence : entry.sequence,
      key: entry.key,
      turnId: entry.turnId || entry.snapshot?.turnId || null,
    });
  }
}

function buildHistoricalWork(turns) {
  const blocks = buildConversationBlocks(turns, { cwd: currentCwd() });
  const representedPlanKeys = new Set(blocks
    .filter((block) => block.type === "plan")
    .map((block) => planSnapshotKey(state.threadId, block.turnId || block.item?.turnId || block.item?.id)));
  const pendingPlans = [...state.planSnapshots]
    .filter(([key]) => !representedPlanKeys.has(key))
    .map(([key, snapshot]) => ({ key, snapshot, sequence: protocolSequenceForPlan(key) }))
    .sort((left, right) => {
      const leftSequence = optionalConversationSequence(left.sequence) ?? Number.POSITIVE_INFINITY;
      const rightSequence = optionalConversationSequence(right.sequence) ?? Number.POSITIVE_INFINITY;
      return leftSequence - rightSequence;
    });
  const work = [];
  let planIndex = 0;
  for (const block of blocks) {
    const blockSequence = protocolSequenceForItem(block.item?.id);
    while (planIndex < pendingPlans.length) {
      const plan = pendingPlans[planIndex];
      const planSequence = optionalConversationSequence(plan.sequence);
      const nextBlockSequence = optionalConversationSequence(blockSequence);
      if (planSequence === null || (nextBlockSequence !== null && planSequence >= nextBlockSequence)) break;
      work.push({ type: "plan", plan });
      planIndex += 1;
    }
    work.push({ type: "block", block });
  }
  for (; planIndex < pendingPlans.length; planIndex += 1) {
    const plan = pendingPlans[planIndex];
    work.push({ type: "plan", plan });
  }
  return work;
}

function renderHistoricalWorkItem(entry) {
  if (entry?.type === "plan") {
    renderPlanCard(entry.plan.snapshot, {
      key: entry.plan.key,
      live: false,
      sequence: entry.plan.sequence,
    });
  } else if (entry?.type === "block") {
    renderHistoricalBlock(entry.block);
  }
}

function renderHistoricalConversation(turns) {
  for (const entry of buildHistoricalWork(turns)) renderHistoricalWorkItem(entry);
}

const HISTORY_SCROLL_DELTA_EPSILON = 0.5;

function hasMeaningfulHistoryScrollDelta(currentTop, baselineTop) {
  const current = Number(currentTop);
  const baseline = Number(baselineTop);
  return Number.isFinite(current)
    && Number.isFinite(baseline)
    && Math.abs(current - baseline) > HISTORY_SCROLL_DELTA_EPSILON;
}

function noteHistoryRestoreScroll() {
  if (!state.historyRestoring && !state.historyLatestScrollPending) return;
  if (state.historyRestoreScrollInterrupted) return;
  if (!hasMeaningfulHistoryScrollDelta(chat.scrollTop, state.historyRestoreScrollBaseline)) return;
  state.historyRestoreScrollInterrupted = true;
  state.historyLatestScrollPending = false;
}

function jumpToLatest() {
  const historyPending = state.historyRestoring || state.historyLatestScrollPending;
  if (historyPending) {
    state.historyRestoreScrollInterrupted = false;
    state.historyLatestScrollPending = true;
  }
  scrollToBottom(true);
  if (historyPending) state.historyRestoreScrollBaseline = chat.scrollTop;
}

function cancelHistoryRestore() {
  state.historyRestoreGeneration += 1;
  state.historyRestoreJob?.cancel?.();
  state.historyRestoreJob = null;
  state.historyRestoring = false;
  state.historyLatestScrollPending = false;
  state.historyRestoreScrollBaseline = null;
  state.historyRestoreScrollInterrupted = false;
  state.conversationReconcilePending = false;
  if (state.historyObserverReleaseTimer !== null) {
    clearTimeout(state.historyObserverReleaseTimer);
    state.historyObserverReleaseTimer = null;
  }
  state.historyObserverMuted = false;
  delete chat.dataset.historyProgress;
}

function finishHistoryRestore(thread, generation) {
  if (generation !== state.historyRestoreGeneration) return;
  state.historyRestoreJob = null;
  state.historyObserverMuted = true;
  restoreProtocolEventOrder();
  if (state.activeView === "changes") renderChangesView();
  if (state.activeView === "commands") renderCommandsView();
  renderConversationOutline();
  state.historyRestoring = false;
  state.conversationReconcilePending = false;
  reconcileConversationNodes();
  updateControls();
  state.historyLatestScrollPending = !state.historyRestoreScrollInterrupted;
  requestAnimationFrame(() => {
    if (generation !== state.historyRestoreGeneration) return;
    if (!state.historyLatestScrollPending || state.historyRestoreScrollInterrupted) {
      messageInput.focus();
      return;
    }
    // A resumed thread opens at its newest message. Persisted scroll positions
    // are intentionally not used as the initial viewport for an old session.
    // Keep the pending flag when the conversation view is hidden so switching
    // back to it can apply the bottom position after layout.
    if (state.activeView === "conversation" && chat.clientHeight > 0) {
      scrollToBottom(true);
      state.historyLatestScrollPending = false;
    }
    messageInput.focus();
  });
  state.historyObserverReleaseTimer = setTimeout(() => {
    state.historyObserverReleaseTimer = null;
    state.historyObserverMuted = false;
    state.conversationReconcilePending = false;
  }, 0);
}

function restoreHistory(thread) {
  cancelHistoryRestore();
  const generation = state.historyRestoreGeneration;
  state.historyRestoreScrollBaseline = chat.scrollTop;
  state.historyRestoreScrollInterrupted = false;
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
  state.activityNodes.clear();
  state.processNodes.clear();
  state.historicalProcessAnswerIds.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.latestPlanKey = null;
  state.processEpochs.clear();
  state.conversationNodeMeta.clear();
  state.conversationNodeOrdinal = 0;
  state.conversationFallbackAnchor = null;
  state.conversationFallbackIndex = 0;
  state.historyOrderRanks.clear();
  state.protocolState = readProtocolState(thread?.id);
  state.commandItems.clear();
  state.changeItems.clear();
  state.commandObservedStartMs.clear();
  state.conversationOrder = [];
  for (const item of state.threadView.items || []) {
    state.protocolState = reduceProtocolState(state.protocolState, {
      method: "item/completed",
      params: { item, threadId: state.threadId, turnId: item.turnId },
    });
  }
  rebuildHistoryOrderRanks();
  for (const [key, snapshot] of state.protocolState.plans || []) {
    state.planSnapshots.set(key, snapshot);
  }
  state.historicalProcessAnswerIds = new Set(buildProcessDetailsForTurns(restoredThread?.turns)
    .map((group) => group.answer?.id)
    .filter(Boolean));
  const work = buildHistoricalWork(restoredThread?.turns);
  state.historyRestoring = true;
  state.conversationReconcilePending = false;
  updateControls();
  state.historyRestoreJob = scheduleTimeSliced(work, renderHistoricalWorkItem, {
    budgetMs: 8,
    onProgress: ({ completed, total }) => {
      chat.dataset.historyProgress = `${completed}/${total}`;
    },
  });
  state.historyRestoreJob.promise.then((result) => {
    if (result.cancelled || generation !== state.historyRestoreGeneration) return;
    for (const [key, snapshot] of state.planSnapshots) {
      if (!state.planNodes.has(key)) renderPlanCard(snapshot, { key, live: false });
    }
    delete chat.dataset.historyProgress;
    finishHistoryRestore(thread, generation);
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
  const eventThreadId = runtimeThreadIdFromNotification(message);

  // Keep background Thread state even when its transcript is not mounted.
  // Only the selected Thread is allowed to mutate the live DOM renderer.
  if (eventThreadId && eventThreadId !== state.threadId) {
    if (message.id !== undefined && message.method !== undefined) rememberPendingRuntimeRequest(message, eventThreadId);
    else rememberRuntimeNotification(message);
    return;
  }

  if (message.id !== undefined) {
    if (!isNotificationForThread(params, state.threadId)) return;
    if (isSnapshotMode()) {
      addSystemMessage("A live tool request was ignored because this thread is a read-only snapshot.", "warning");
      return;
    }
    state.pendingServerRequests.set(String(message.id), {
      method,
      threadId: params.threadId || state.threadId,
      turnId: params.turnId || state.activeTurnId,
      message,
    });
    syncRuntimeFromCurrentState();
    if (method === "item/tool/requestUserInput") {
      openUserInputRequest(message);
      syncRuntimeFromCurrentState();
      return;
    }
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      addApproval(message);
      syncRuntimeFromCurrentState();
      return;
    }
    addSystemMessage(`Unsupported App Server request declined: ${method}`, "warning");
    send({ type: "approval", threadId: params.threadId || state.threadId, requestId: message.id, decision: "decline" });
    return;
  }

  // Ultra can run child turns on separate threads. Their lifecycle must not
  // overwrite the active turn state shown for the selected thread.
  if (!isNotificationForThread(params, state.threadId)) return;
  if (isSnapshotMode() && !shouldProcessSnapshotNotification(method)) return;
  const protocolItem = applyProtocolNotification(message);
  saveProtocolState();

  switch (method) {
    case "thread/name/updated":
      if (params.threadId === state.threadId) {
        const name = params.threadName ?? "";
        state.threadMeta = { ...state.threadMeta, name };
        updateCurrentThreadListMetadata({ name });
        updateControls();
      }
      break;

    case "thread/goal/updated":
      if (params.threadId === state.threadId) {
        state.threadMeta = { ...state.threadMeta, goal: params.goal || null };
        updateControls();
      }
      break;

    case "thread/goal/cleared":
      if (params.threadId === state.threadId) {
        state.threadMeta = { ...state.threadMeta, goal: null };
        updateControls();
      }
      break;

    case "thread/environment/connected":
    case "thread/environment/disconnected":
      if (params.threadId === state.threadId) {
        state.threadMeta = {
          ...state.threadMeta,
          environmentId: params.environmentId || null,
          environmentStatus: method.endsWith("connected") ? "connected" : "disconnected",
        };
        updateControls();
      }
      break;

    case "thread/archived":
      if (params.threadId === state.threadId) {
        clearQueuedMessages();
        setThreadLifecycle("archived", { archived: true, closed: false });
        addSystemMessage("Thread archived by Codex.", "warning");
      }
      break;

    case "thread/unarchived":
      if (params.threadId === state.threadId) {
        setThreadLifecycle("idle", { archived: false, closed: false });
        addSystemMessage("Thread unarchived.");
      }
      break;

    case "thread/closed":
      if (params.threadId === state.threadId) {
        clearQueuedMessages();
        setThreadLifecycle("closed", { closed: true });
        addSystemMessage("Thread closed by Codex.", "warning");
      }
      break;

    case "thread/status/changed":
      if (!params.threadId || params.threadId === state.threadId) {
        if (state.threadMeta.closed || state.threadMeta.archived) {
          updateControls();
          break;
        }
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
        const threadSettings = params.threadSettings || params.settings || params;
        if (!settingsResponseIsCurrent(params.threadId || state.threadId, threadSettings)) break;
        mergeThreadSettings(threadSettings);
        addSystemMessage("Thread settings synchronized.");
      }
      break;

    case "account/updated":
      state.account = params.account || params;
      updateControls();
      break;

    case "account/rateLimits/updated":
      state.accountRateLimits = params.rateLimits || params;
      break;

    case "thread/deleted":
      handleThreadDeleted({ threadId: params.threadId });
      break;

    case "mcpServerStatus/updated":
    case "mcpServer/startupStatus/updated":
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
      if (isSnapshotMode()) break;
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
      if (isSnapshotMode()) break;
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
      const item = protocolItem || params.item;
      const displayItem = item && item.id ? item : item ? {
        ...item,
        id: params.itemId || `event-${state.protocolState.sequence}`,
      } : item;
      if (displayItem && ["commandExecution", "fileChange", "mcpToolCall"].includes(displayItem.type)) updateTool(displayItem);
      if (displayItem?.type === "webSearch") updateSearchStep(displayItem, { active: true });
      if (displayItem && ["dynamicToolCall", "collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus", "imageView", "imageGeneration", "contextCompaction", "enteredReviewMode", "exitedReviewMode", "review", "hookPrompt", "sleep", "reasoning", "thinking"].includes(displayItem.type)) {
        ensureActivityItem(displayItem);
      } else if (displayItem && !["commandExecution", "fileChange", "mcpToolCall", "webSearch", "userMessage", "agentMessage", "plan", "reasoning", "thinking"].includes(displayItem.type)) {
        ensureActivityItem(displayItem);
      }
      startSearchActivity(displayItem);
      syncActivityFromProtocol();
      break;
    }

    case "item/agentMessage/delta": {
      const id = params.itemId;
      if (!id) break;
      const record = ensureMessage(id, "assistant", {
        process: true,
        live: true,
        turnId: params.turnId || state.activeTurnId || state.currentTurn?.id,
        turn: state.currentTurn,
        model: params.model || state.currentTurn?.model || state.threadMeta.model,
      });
      record.streaming = true;
      record.streamStarted = true;
      record.raw += params.delta || "";
      scheduleRender(record);
      break;
    }

    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      if (protocolItem?.id) {
        ensureActivityItem(protocolItem, { live: true, process: true, turnId: params.turnId || state.activeTurnId });
        syncActivityFromProtocol();
      }
      break;

    case "item/commandExecution/outputDelta":
      appendToolOutput(params.itemId, params.delta);
      syncActivityFromProtocol();
      break;

    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
      if (protocolItem?.id) {
        updateTool(protocolItem);
        syncActivityFromProtocol();
      }
      break;

    case "item/mcpToolCall/progress": {
      const item = protocolItem || (params.itemId ? getProtocolItem(state.protocolState, params.itemId) : null);
      if (item?.id) {
        updateTool({ ...item, progress: params.message || item.progress || "" });
        syncActivityFromProtocol();
      }
      break;
    }

    case "serverRequest/resolved": {
      const requestId = String(params.requestId ?? "");
      state.pendingServerRequests.delete(requestId);
      state.approvals = removeQueuedApproval(state.approvals, params.requestId);
      if (state.userInputRequest?.requestId !== undefined && String(state.userInputRequest.requestId) === requestId) {
        clearUserInputRequest();
      } else {
        renderApprovalQueue();
        if (state.running) syncActivityFromProtocol();
      }
      break;
    }

    case "item/completed": {
      const item = protocolItem || params.item;
      const displayItem = item && item.id ? item : item ? {
        ...item,
        id: params.itemId || `event-${state.protocolState.sequence}`,
      } : item;
      if (!displayItem) break;
      if (displayItem.type === "agentMessage") {
        const record = ensureMessage(displayItem.id, "assistant", {
          process: true,
          live: true,
          turnId: displayItem.turnId || params.turnId || state.activeTurnId || state.currentTurn?.id,
          item: displayItem,
          turn: state.currentTurn,
          model: displayItem.model || state.currentTurn?.model || state.threadMeta.model,
        });
        const pendingRender = state.renderTimers.get(displayItem.id);
        if (pendingRender) {
          clearTimeout(pendingRender);
          state.renderTimers.delete(displayItem.id);
        }
        record.raw = displayItem.text || record.raw;
        renderCompletedMessage(record, record.raw);
      } else if (displayItem.type === "plan") {
        const turnId = displayItem.turnId || params.turnId || state.activeTurnId || state.currentTurn?.id;
        const key = planSnapshotKey(state.threadId, turnId);
        if (!state.planSnapshots.has(key)) {
          renderPlanCard({
            threadId: state.threadId,
            turnId,
            explanation: null,
            steps: [],
          }, {
            key,
            text: displayItem.text || state.planDeltaBuffers.get(displayItem.id) || "",
            itemId: displayItem.id,
          });
        }
        state.planDeltaBuffers.delete(displayItem.id);
      } else if (["commandExecution", "fileChange", "mcpToolCall"].includes(displayItem.type)) {
        updateTool(displayItem);
        if (displayItem.type === "fileChange") scheduleFileWorkspaceRefresh();
      } else if (displayItem.type === "webSearch") {
        updateSearchStep(displayItem, { active: false });
      } else if (["dynamicToolCall", "collabToolCall", "collabAgentToolCall", "subAgentActivity", "agentStatus", "imageView", "imageGeneration", "contextCompaction", "enteredReviewMode", "exitedReviewMode", "review", "hookPrompt", "sleep", "reasoning", "thinking"].includes(displayItem.type)) {
        ensureActivityItem(displayItem);
      } else if (displayItem.type === "error") {
        addProcessError(displayItem, displayItem.turnId || params.turnId || state.activeTurnId);
      } else if (!["userMessage", "reasoning", "thinking"].includes(displayItem.type)) {
        ensureActivityItem(displayItem);
      }
      completeSearchActivity(displayItem);
      if (state.running) syncActivityFromProtocol();
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
      if (method.startsWith("item/") && protocolItem?.id
        && !["agentMessage", "commandExecution", "fileChange", "mcpToolCall", "webSearch", "plan"].includes(protocolItem.type)) {
        ensureActivityItem(protocolItem);
        syncActivityFromProtocol();
      }
      break;
  }
  syncRuntimeFromCurrentState();
  renderThreadList();
}

function applyThreadResponse(payload) {
  const incomingThreadId = String(payload.thread?.id || payload.threadId || "").trim();
  if (!incomingThreadId) return;
  if (state.threadId && state.threadId !== incomingThreadId) captureSelectedRuntime();
  const previousRuntime = getThreadRuntime(state.threadRuntimes, incomingThreadId, false);
  clearQueuedMessages();
  if (state.threadId && state.threadId !== incomingThreadId) {
    saveThreadUi();
    saveToolCache();
  }
  state.threadId = incomingThreadId;
  state.selectedThreadId = incomingThreadId;
  state.selectionPending = false;
  selectThreadRuntime(state.threadRuntimes, incomingThreadId, { markRead: true });
  persistSelectedThread(incomingThreadId);
  const operation = payload.operation || payload.mode;
  state.accessMode = payload.accessMode || (operation === "snapshot" ? "snapshot" : "live");
  state.snapshotAt = state.accessMode === "snapshot" ? payload.snapshotAt || new Date().toISOString() : null;
  state.snapshotReason = state.accessMode === "snapshot" ? payload.snapshotReason || "active_writer" : null;
  activateThreadUi(state.threadId);
  const runtime = getThreadRuntime(state.threadRuntimes, state.threadId, false);
  const runtimeTokenUsage = runtime?.tokenUsage || runtime?.latestEvent?.params?.tokenUsage || runtime?.latestEvent?.params?.token_usage;
  if (state.tokenUsageThreadId !== state.threadId) {
    state.tokenUsage = runtimeTokenUsage || null;
    state.tokenUsageThreadId = runtimeTokenUsage ? state.threadId : null;
  }
  state.activeTurnId = payload.activeTurnId || payload.runtime?.activeTurnId || runtime?.activeTurnId || null;
  state.running = payload.running !== undefined
    ? Boolean(payload.running)
    : Boolean(payload.runtime?.running ?? runtime?.running ?? state.activeTurnId);
  state.threadStatus = normalizeThreadStatus(payload.thread?.status || runtime?.status || (state.running ? "active" : "idle"));
  if (state.running) setTurnActivityWorking(payload.startedAt || runtime?.latestEvent?.params?.turn?.startedAt);
  else clearTurnActivity();
  const reasoningEffort = resolveReasoningEffort(payload) || resolveReasoningEffort(payload.thread);
  const storedMode = payload.thread?.id ? localStorage.getItem(collaborationModeStorageKey(payload.thread.id)) : "";
  const initialMode = operation === "start"
    ? collaborationModeValue(collaborationModeSelect.value)
    : storedMode || "";
  state.threadMeta = {
    name: payload.thread?.name,
    preview: payload.thread?.preview,
    cliVersion: payload.thread?.cliVersion,
    createdAt: payload.thread?.createdAt,
    updatedAt: payload.thread?.updatedAt,
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
    goal: payload.thread?.goal || null,
    environmentId: payload.thread?.environmentId || null,
    environmentStatus: payload.thread?.environmentStatus || null,
    archived: payload.thread?.archived === true || state.threadStatus === "archived",
    closed: payload.thread?.closed === true || state.threadStatus === "closed",
  };

  updateThreadRuntime(state.threadRuntimes, state.threadId, {
    activeTurnId: state.activeTurnId,
    status: state.threadStatus,
    running: state.running || isActiveTurnStatus(payload.thread?.turns?.at?.(-1)?.status),
    accessMode: state.accessMode,
    snapshotAt: state.snapshotAt,
    snapshotReason: state.snapshotReason,
    latestThread: payload.thread,
    pendingServerRequests: payload.pendingServerRequests
      ?? payload.pendingRequests
      ?? previousRuntime?.pendingServerRequests
      ?? [],
  }, { markUnread: false });

  if (!state.navigatingHistory) state.navigation = pushThreadNavigation(state.navigation, state.threadId);
  state.navigatingHistory = false;

  localStorage.setItem("codexMathThreadId", state.threadId);
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
    ["Thread name", state.threadMeta.name || "--"],
    ["Goal", state.threadMeta.goal?.objective || state.threadMeta.goal || "--"],
    ["Environment", state.threadMeta.environmentStatus
      ? `${state.threadMeta.environmentStatus}${state.threadMeta.environmentId ? ` · ${state.threadMeta.environmentId}` : ""}`
      : "--"],
    ["Access", state.accessMode || "unknown"],
    ["Snapshot at", state.snapshotAt ? snapshotTimeLabel(state.snapshotAt) : "--"],
    ["Snapshot reason", state.snapshotReason || "--"],
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
    accessMode: state.accessMode,
    snapshotAt: state.snapshotAt,
    snapshotReason: state.snapshotReason,
    protocol: toProtocolSnapshot(state.protocolState),
  }, null, 2);
  statusDialog.showModal();
}

function clearPendingRenderTimers() {
  cancelHistoryRestore();
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
  if (state.outlineRenderTimer !== null) {
    clearTimeout(state.outlineRenderTimer);
    state.outlineRenderTimer = null;
  }
  if (state.outlinePreviewHideTimer !== null) {
    clearTimeout(state.outlinePreviewHideTimer);
    state.outlinePreviewHideTimer = null;
  }
}

function clearTranscript(showNotice = true) {
  clearUserInputRequest();
  clearPendingRenderTimers();
  chat.replaceChildren();
  state.messageNodes.clear();
  state.toolNodes.clear();
  state.activityNodes.clear();
  state.processNodes.clear();
  state.historicalProcessAnswerIds.clear();
  state.searchNodes.clear();
  state.planSnapshots.clear();
  state.planNodes.clear();
  state.planDeltaBuffers.clear();
  state.latestPlanKey = null;
  state.processEpochs.clear();
  state.conversationNodeMeta.clear();
  state.conversationNodeOrdinal = 0;
  state.conversationFallbackAnchor = null;
  state.conversationFallbackIndex = 0;
  state.historyOrderRanks.clear();
  state.protocolState = createProtocolState();
  state.commandObservedStartMs.clear();
  state.conversationOrder = [];
  clearQueuedMessages();
  state.toolCacheItems.clear();
  state.toolCacheSequence = 0;
  state.lastSavedToolCache = null;
  if (state.threadId) sessionStorage.removeItem(threadToolStorageKey(state.threadId));
  if (state.threadId) sessionStorage.removeItem(protocolStateStorageKey(state.threadId));
  state.latestDiff = "";
  if (showNotice) addSystemMessage("Browser transcript cleared. Codex context was not changed.", "warning");
  renderConversationOutline();
}

function startNewThread(sessionStartSource = null) {
  if (!canBeginThreadSelection(state.selectionPending)) return;
  const cwd = cwdInput.value.trim();
  if (!cwd) {
    addSystemMessage("Enter a WSL project directory first.", "error");
    return;
  }
  clearUserInputRequest();
  localStorage.setItem("codexMathCwd", cwd);
  saveControlPreferences();
  const settings = selectedSettings();
  prepareNewThreadSelection();
  if (!send({ type: "startThread", cwd, sessionStartSource, ...settings })) {
    state.selectionPending = false;
    updateControls();
  }
}

function resumeThread(threadId = "") {
  if (!canBeginThreadSelection(state.selectionPending)) return;
  threadId = String(threadId || "").trim();
  if (!threadId) {
    addSystemMessage("A thread ID is required.", "error");
    return;
  }
  prepareThreadSelection(threadId);
  state.selectionPending = true;
  updateControls();
  clearUserInputRequest();
  if (!send({ type: "resumeThread", threadId })) {
    state.selectionPending = false;
    updateControls();
  }
}

function updateThreadSettings() {
  saveControlPreferences();
  if (!state.threadId) {
    updateControls();
    return;
  }
  if (!requireWritable("change thread settings")) {
    updateControls();
    return;
  }
  const settings = selectedSettings();
  const revision = state.settingsRequestSequence + 1;
  state.settingsRequestSequence = revision;
  state.latestSettingsRequests.set(state.threadId, { revision, settings });
  state.pendingSettingsThreadId = state.threadId;
  if (!send({ type: "updateSettings", threadId: state.threadId, settingsRevision: revision, ...settings })) {
    state.latestSettingsRequests.delete(state.threadId);
  }
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

const SNAPSHOT_READABLE_SLASHES = new Set([
  "/status", "/mcp", "/skills", "/hooks", "/apps", "/plugins", "/usage", "/debug-config",
  "/ps", "/copy", "/diff", "/resume", "/fork", "/new", "/clear", "/model", "/permissions",
  "/fast", "/memories", "/goal",
]);

function snapshotSlashAllowed(command, args = []) {
  if (!SNAPSHOT_READABLE_SLASHES.has(command)) return false;
  const mode = String(args[0] || "").toLowerCase();
  if (command === "/model" || command === "/permissions") return args.length === 0;
  if (command === "/fast") return mode === "status";
  if (command === "/memories") return !args.length || mode === "status";
  if (command === "/goal") return !args.length;
  if (command === "/mcp") return !args.length || mode === "summary" || mode === "verbose";
  return true;
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
  if (isSnapshotMode() && !snapshotSlashAllowed(command, args)) {
    requireWritable(`run ${command}`);
    return true;
  }

  switch (command) {
    case "/model":
      if (!args.length) {
        showModelChoices();
      } else {
        if (!requireWritable("change the model")) break;
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
        if (!requireWritable("change the permission profile")) break;
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
        send({ type: "setMemoryMode", threadId: state.threadId, mode: mode === "on" ? "enabled" : "disabled" });
      } else {
        addSystemMessage("Usage: /memories [on|off|status]", "error");
      }
      break;
    }
    case "/review":
      send({ type: "reviewThread", threadId: state.threadId, instructions: args.join(" ") });
      break;
    case "/rename": {
      const name = args.join(" ").trim();
      if (!name) addSystemMessage("Usage: /rename <name>", "error");
      else send({ type: "renameThread", threadId: state.threadId, name });
      break;
    }
    case "/archive":
      if (window.confirm("Archive the current Codex thread?")) send({ type: "archiveThread", threadId: state.threadId });
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
      if (!value) send({ type: "getGoal", threadId: state.threadId });
      else if (value.toLowerCase() === "clear") send({ type: "clearGoal", threadId: state.threadId });
      else send({ type: "setGoal", threadId: state.threadId, objective: value });
      break;
    }
    case "/mcp": {
      const mode = (args[0] || "summary").toLowerCase();
      if (!["summary", "verbose", "reload"].includes(mode)) {
        addSystemMessage("Usage: /mcp [verbose|reload]", "error");
      } else if (mode === "reload") {
        if (!requireWritable("reload MCP servers")) break;
        state.mcpDialogRequested = true;
        send({ type: "reloadMcp", threadId: state.threadId, verbose: args[1]?.toLowerCase() === "verbose" });
      } else {
        state.mcpDialogRequested = true;
        send({ type: "listMcp", threadId: state.threadId, verbose: mode === "verbose" });
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
      send({ type: "listApps", threadId: state.threadId, forceRefetch: (args[0] || "").toLowerCase() === "reload" });
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
      send({ type: "compact", threadId: state.threadId });
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
      send({ type: "forkThread", threadId: state.threadId });
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
        send({ type: "approveGuardianDeniedAction", threadId: state.threadId, event: state.latestGuardianDenial });
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
      send({ type: "setExperiment", threadId: state.threadId, name, enabled });
      break;
    }
    case "/ps":
      send({ type: "listBackgroundTerminals", threadId: state.threadId });
      break;
    case "/stop":
      send({ type: "cleanBackgroundTerminals", threadId: state.threadId });
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
          select: () => send({ type: "updateSettings", threadId: state.threadId, personality: value }),
        })));
      } else if (!["none", "friendly", "pragmatic"].includes(personality)) {
        addSystemMessage("Usage: /personality <none|friendly|pragmatic>", "error");
      } else if (!state.threadId) {
        addSystemMessage("Start or resume a thread before changing personality.", "error");
      } else {
        send({ type: "updateSettings", threadId: state.threadId, personality });
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

function measureComposerScrollHeight() {
  const parent = messageInput.parentElement;
  const width = messageInput.getBoundingClientRect().width;
  if (!parent || !width) return messageInput.scrollHeight;
  const probe = messageInput.cloneNode();
  probe.removeAttribute("id");
  probe.value = messageInput.value;
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    width: `${width}px`,
    height: "auto",
    maxHeight: "none",
    overflowY: "hidden",
  });
  parent.append(probe);
  const height = probe.scrollHeight;
  probe.remove();
  return height;
}

function autoSizeComposer() {
  const wasFollowing = state.followOutput;
  const previousChatHeight = chat.clientHeight;
  const currentHeight = messageInput.getBoundingClientRect().height;
  const nextHeight = Math.min(200, Math.max(24, measureComposerScrollHeight()));
  const heightChanged = Math.abs(nextHeight - currentHeight) > 0.5;

  if (heightChanged) {
    messageInput.style.height = `${nextHeight}px`;
    syncApprovalAreaPosition();
    if (wasFollowing && chat.clientHeight !== previousChatHeight) chat.scrollTop = chat.scrollHeight;
  } else {
    syncApprovalAreaPosition();
  }
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
  if (isSnapshotMode()) {
    requireWritable("send a message");
    return;
  }
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
  if (!requireWritable("send a message")) return false;
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
  if (!requireWritable("steer the active turn")) return;
  const input = composeCurrentInput();
  if (!input) return;
  clearComposerInput();
  steerCurrentTurn(input);
}

function submitFollowUp() {
  if (!requireWritable("queue a follow-up")) return;
  const input = composeCurrentInput();
  if (!input) return;
  clearComposerInput();
  enqueueFollowUp(input);
}

function handleSocketMessage(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    addSystemMessage("Invalid bridge message.", "error");
    return;
  }
  payload = canonicalizeThreadReadyPayload(payload);
  const scopedPayloadThreadId = payloadThreadId(payload);
  const explicitHistorySwitchTarget = payload.type === "threadReady"
    && state.historySwitchTargetId === scopedPayloadThreadId;
  if (scopedPayloadThreadId
    && state.threadId
    && scopedPayloadThreadId !== state.threadId
    && !explicitHistorySwitchTarget
    && !["runtimeSnapshot", "runtimeUpdate", "threadRuntime", "threadRuntimeSnapshot", "codex"].includes(payload.type)) {
    handleBackgroundBridgePayload(payload, scopedPayloadThreadId);
    return;
  }
  switch (payload.type) {
    case "ready":
      state.ready = true;
      state.fileAccessToken = payload.fileAccessToken || null;
      state.defaultCwd = payload.defaultCwd || payload.fileAccessCwd || null;
      state.serverInfo = payload.serverInfo || null;
      state.models = payload.models || [];
      state.config = payload.config;
      state.account = payload.account;
      state.permissionProfiles = payload.permissionProfiles || [];
      state.experiments = payload.experiments || [];
      state.collaborationModes = payload.collaborationModes || [];
      state.metadataErrors = payload.metadataErrors || {};
      applyRuntimeMessage(payload);
      if (payload.threadList) {
        applyThreadList(payload.threadList, false, payload.threadListError);
      } else {
        state.threadListLoading = payload.threadListPending !== false;
        state.threadListError = payload.threadListPending === false ? "Recent sessions are unavailable." : null;
        renderThreadList("ready");
        if (payload.threadListPending === false) refreshThreadList();
      }
      cwdInput.value = localStorage.getItem("codexMathCwd") || payload.defaultCwd || "";
      const savedThreadId = readSelectedThread(sessionStorage, localStorage.getItem("codexMathThreadId"));
      state.selectedThreadId = savedThreadId;
      populateModels();
      {
        const savedMode = localStorage.getItem("codexRightPanelMode");
        const savedInspector = localStorage.getItem("codexInspectorOpen");
        const initialMode = ["closed", "files", "inspector"].includes(savedMode)
          ? savedMode
          : savedInspector === "true"
            ? "inspector"
            : "closed";
        setRightPanelMode(initialMode, { persist: false });
      }
      resetFileWorkspace(payload.fileAccessCwd || payload.defaultCwd || "", { force: true });
      syncSidebarViewport();
      setConnection("Codex ready", true);
      updateControls();
      if (savedThreadId) {
        // A lost socket cannot complete the previous selection transition;
        // allow the reconnect handshake to retry it once.
        state.selectionPending = false;
        resumeThread(savedThreadId);
      }
      break;

    case "runtimeSnapshot":
    case "runtimeUpdate":
    case "threadRuntime":
    case "threadRuntimeSnapshot":
      applyRuntimeMessage(payload);
      break;

    case "metadata":
      state.models = payload.models || state.models;
      state.config = payload.config ?? state.config;
      state.account = payload.account ?? state.account;
      state.permissionProfiles = payload.permissionProfiles || state.permissionProfiles;
      state.experiments = payload.experiments || state.experiments;
      state.collaborationModes = payload.collaborationModes || state.collaborationModes;
      state.metadataErrors = payload.metadataErrors || state.metadataErrors;
      if (payload.fileAccessCwd) resetFileWorkspace(payload.fileAccessCwd, { force: true });
      populateModels(currentModelLabel());
      updateControls();
      break;

    case "threadReady":
      state.historySwitchTargetId = null;
      clearUserInputRequest();
      applyThreadResponse(payload);
      resetFileWorkspace(state.threadMeta.cwd || state.defaultCwd || "");
      clearPendingRenderTimers();
      chat.replaceChildren();
      approvalArea.replaceChildren();
      state.messageNodes.clear();
      state.toolNodes.clear();
      state.activityNodes.clear();
      state.processNodes.clear();
      state.historicalProcessAnswerIds.clear();
      state.searchNodes.clear();
      state.planSnapshots.clear();
      state.planNodes.clear();
      state.planDeltaBuffers.clear();
      state.latestPlanKey = null;
      state.processEpochs.clear();
      state.conversationNodeMeta.clear();
      state.conversationNodeOrdinal = 0;
      state.conversationFallbackAnchor = null;
      state.conversationFallbackIndex = 0;
      state.historyOrderRanks.clear();
      state.protocolState = createProtocolState();
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
      state.pendingServerRequests.clear();
      restorePendingRuntimeRequests(selectedRuntime());
      const operation = payload.operation || payload.mode;
      if (operation === "resume" || operation === "snapshot" || operation === "fork") restoreHistory(payload.thread);
      else {
        clearTurnActivity();
        if (state.activeView === "changes") renderChangesView();
        if (state.activeView === "commands") renderCommandsView();
      }
      if (!(operation === "resume" || operation === "snapshot" || operation === "fork")) renderConversationOutline();
      const notice = state.accessMode === "snapshot"
        ? "Read-only snapshot loaded. Refresh to read the latest persisted history."
          : operation === "resume"
          ? "Thread resumed and settings synchronized."
          : operation === "fork"
            ? "Thread forked into a live session."
            : "New Codex thread created.";
      addSystemMessage(notice, state.accessMode === "snapshot" ? "warning" : "info");
      refreshThreadList();
      updateControls();
      if (!(operation === "resume" || operation === "snapshot" || operation === "fork")) messageInput.focus();
      break;

    case "settingsUpdateAccepted": {
      const settingsThreadId = payload.threadId || state.pendingSettingsThreadId || state.threadId;
      if (!settingsResponseIsCurrent(settingsThreadId, payload.requested || {}, payload.settingsRevision)) break;
      retireSettingsRequest(state.latestSettingsRequests, settingsThreadId, payload.requested || {}, payload.settingsRevision);
      if (payload.threadId && payload.threadId !== state.threadId) {
        updateThreadRuntime(state.threadRuntimes, payload.threadId, { pendingTurnSettings: payload.requested || {} });
        renderThreadList();
        break;
      }
      if (state.pendingSettingsThreadId && state.pendingSettingsThreadId !== state.threadId) {
        updateThreadRuntime(state.threadRuntimes, state.pendingSettingsThreadId, { pendingTurnSettings: payload.requested || {} });
        state.pendingSettingsThreadId = null;
        renderThreadList();
        break;
      }
      state.pendingSettingsThreadId = null;
      mergeThreadSettings(payload.requested);
      if (payload.mode === "thread" && payload.requested?.cwd) resetFileWorkspace(payload.requested.cwd, { force: true });
      addSystemMessage(payload.mode === "thread" ? "Model/settings update accepted by App Server." : `Settings will apply on the next turn. App Server update fallback: ${payload.warning}`, payload.mode === "thread" ? "info" : "warning");
      break;
    }

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
        state.steerRequestThreads.delete(payload.requestId);
        addSystemMessage(payload.error?.message || "Steer was not accepted.", "error");
        break;
      }
      {
        const input = state.steerRequestInputs.get(payload.requestId);
        state.steerRequestInputs.delete(payload.requestId);
        state.steerRequestThreads.delete(payload.requestId);
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
      persistSelectedThread(null);
      state.threadId = null;
      state.selectedThreadId = null;
      state.accessMode = null;
      state.snapshotAt = null;
      state.snapshotReason = null;
      state.activeTurnId = null;
      state.running = false;
      state.threadStatus = "notLoaded";
      state.threadMeta = {};
      clearTurnActivity();
      state.tokenUsage = null;
      state.tokenUsageThreadId = null;
      state.latestGuardianDenial = null;
      localStorage.removeItem("codexMathThreadId");
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

    case "serverRequestsExpired":
      for (const requestId of payload.requestIds || []) {
        state.pendingServerRequests.delete(String(requestId));
        state.approvals = removeQueuedApproval(state.approvals, requestId);
      }
      if (state.userInputRequest && (payload.requestIds || []).some((id) => String(id) === String(state.userInputRequest.requestId))) {
        clearUserInputRequest();
      }
      renderApprovalQueue();
      addSystemMessage(payload.message || "Pending Codex requests expired because the App Server stopped.", "error");
      updateControls();
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
      state.selectionPending = false;
      state.running = false;
      clearTurnActivity();
      addSystemMessage(payload.message, "error");
      updateControls();
      break;

    default:
      break;
  }
  if (state.threadId) syncRuntimeFromCurrentState();
}

function handleBridgeOpen() {
  state.reconnecting = false;
  setConnection("Bridge connected", true);
  updateControls();
}

function handleBridgeClose() {
  captureSelectedRuntime();
  state.ready = false;
  state.reconnecting = bridge.state === "reconnecting";
  setConnection(state.reconnecting ? "Disconnected; retrying" : "Disconnected", false);
  updateControls();
}

function handleBridgeError(event) {
  const message = event?.message || event?.error?.message || "WebSocket error";
  setConnection(`${message}; retrying`, false);
}

function handleBridgeStateChange(event) {
  if (event?.state === "reconnecting") {
    state.reconnecting = true;
    setConnection(`Reconnecting (attempt ${bridge.reconnectAttempt})`, false);
  } else if (event?.state === "closed" && !state.ready) {
    setConnection(bridge.reconnectExhausted ? "Disconnected" : "Connecting", false);
  }
}

bridge.addEventListener("open", handleBridgeOpen);
bridge.addEventListener("close", handleBridgeClose);
bridge.addEventListener("error", handleBridgeError);
bridge.addEventListener("statechange", handleBridgeStateChange);
bridge.subscribe(handleSocketMessage);
try {
  bridge.start?.();
} catch (error) {
  handleBridgeError(error);
}
if (bridge.readyState === 1) handleBridgeOpen();

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
  if (view === "conversation" && state.historyLatestScrollPending) {
    const generation = state.historyRestoreGeneration;
    requestAnimationFrame(() => {
      if (generation !== state.historyRestoreGeneration
        || state.historyRestoring
        || !state.historyLatestScrollPending
        || state.historyRestoreScrollInterrupted) return;
      scrollToBottom(true);
      state.historyLatestScrollPending = false;
    });
  }
  requestAnimationFrame(measureConversationMinimap);
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
    if (state.rightPanelMode !== "closed") setRightPanelMode("closed", { persist: false });
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
  const rightPanelOverlayOpen = window.innerWidth < 1360 && state.rightPanelMode !== "closed";
  drawerBackdrop.classList.toggle("hidden", !sidebarOpen && !rightPanelOverlayOpen);
}

function toggleInspector(force) {
  const mode = force === true
    ? "inspector"
    : force === false
      ? "closed"
      : toggleRightPanelMode(state.rightPanelMode, "inspector");
  setRightPanelMode(mode);
}

function closeDrawers() {
  sidebar.classList.remove("open");
  if (window.innerWidth < 1360 && state.rightPanelMode !== "closed") setRightPanelMode("closed");
  syncSidebarToggle();
  updateBackdrop();
}

function navigateHistory(delta) {
  if (!canBeginThreadSelection(state.selectionPending)) return;
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
statusButton.addEventListener("click", showStatus);
connectionStatus.addEventListener("click", () => send({ type: "refreshMetadata", cwd: cwdInput.value.trim() }));
sendButton.addEventListener("click", submitMessage);
steerButton.addEventListener("click", submitSteerNow);
followUpButton.addEventListener("click", submitFollowUp);
function interruptActiveTurn() {
  if (isSnapshotMode()) return;
  if (!state.running || !state.activeTurnId) return;
  if (send({ type: "interrupt", threadId: state.threadId, turnId: state.activeTurnId })) {
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
  if (!event.target.closest(".composer")) {
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
chatMinimapRail.addEventListener("pointerdown", beginConversationMinimapDrag);
chatMinimapRail.addEventListener("pointerenter", showConversationMinimapPreview);
chatMinimapRail.addEventListener("pointerleave", scheduleConversationMinimapPreviewHide);
chatMinimapRail.addEventListener("pointermove", (event) => locateConversationMinimapPointer(event.clientY));
chatMinimapRail.addEventListener("keydown", handleConversationMinimapKeydown);
conversationOutline.addEventListener("pointerenter", showConversationMinimapPreview);
conversationOutline.addEventListener("pointerleave", scheduleConversationMinimapPreviewHide);
$("#inspectorButton").addEventListener("click", () => toggleInspector());
filePanelButton.addEventListener("click", () => toggleFilePanel());
$("#closeFilePanelButton").addEventListener("click", () => toggleFilePanel(false));
$("#mobileMoreButton").addEventListener("click", () => toggleInspector(true));
$("#closeInspectorButton").addEventListener("click", () => toggleInspector(false));
explorerToggleButton.addEventListener("click", () => {
  const collapsed = explorerShell.classList.toggle("collapsed");
  explorerToggleButton.setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem("codexExplorerOpen", String(!collapsed));
});
refreshExplorerButton.addEventListener("click", () => {
  refreshExplorer({ refreshActiveFile: true });
});
rightPanelResizeHandle.addEventListener("pointerdown", beginFilePanelResize);
rightPanelResizeHandle.addEventListener("keydown", (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const current = Number(rightPanelResizeHandle.getAttribute("aria-valuenow")) || 480;
  setFilePanelWidth(current + (event.key === "ArrowLeft" ? 16 : -16), { persist: true });
});
sidebarToggleButton.addEventListener("click", toggleSidebar);
window.addEventListener("resize", syncSidebarViewport);
drawerBackdrop.addEventListener("click", closeDrawers);
$("#backThreadButton").addEventListener("click", () => navigateHistory(-1));
$("#forwardThreadButton").addEventListener("click", () => navigateHistory(1));
$("#refreshMcpButton").addEventListener("click", () => { state.mcpDialogRequested = false; send({ type: "listMcp", threadId: state.threadId, verbose: false }); });
refreshSnapshotButton?.addEventListener("click", () => {
  if (!state.threadId || !isSnapshotMode()) return;
  refreshSnapshotButton.disabled = true;
  send({ type: "refreshThreadSnapshot", threadId: state.threadId });
});
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
  noteHistoryRestoreScroll();
  state.followOutput = shouldFollowScroll(chat);
  jumpToBottomButton.classList.toggle("hidden", state.followOutput);
  syncConversationMinimapActive();
  if (state.threadId) scheduleThreadUiSave();
}, { passive: true });
jumpToBottomButton.addEventListener("click", jumpToLatest);
chat.addEventListener("click", openFileLinkFromEvent);
fileViewer.addEventListener("click", openFileLinkFromEvent);
chat.addEventListener("toggle", () => {
  if (state.historyRestoring || state.historyObserverMuted) return;
  requestAnimationFrame(() => scrollToBottom());
}, true);
new MutationObserver(() => {
  if (state.historyRestoring || state.historyObserverMuted) {
    state.conversationReconcilePending = true;
    return;
  }
  requestAnimationFrame(() => scrollToBottom());
  scheduleConversationOutlineRender();
}).observe(chat, { childList: true, subtree: true, characterData: true });
window.addEventListener("pagehide", () => {
  saveThreadUi();
  saveToolCache();
  for (const data of state.fileViewData.values()) revokeFileViewData(data);
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
  if (state.threadId) send({ type: "updateSettings", threadId: state.threadId, cwd });
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
  if (state.threadId) send({ type: "updateSettings", threadId: state.threadId, cwd });
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
  measureConversationMinimap();
});

if (composer && typeof ResizeObserver === "function") {
  new ResizeObserver(syncApprovalAreaPosition).observe(composer);
}
if (typeof ResizeObserver === "function") {
  new ResizeObserver(measureConversationMinimap).observe(chat);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  state.choicePalette = null;
  slashPalette.classList.add("hidden");
  mentionPalette.classList.add("hidden");
  if (window.innerWidth < 1360) closeDrawers();
});

setFilePanelWidth(localStorage.getItem("codexFilePanelWidth") || 480);
{
  const explorerOpen = localStorage.getItem("codexExplorerOpen") !== "false";
  explorerShell.classList.toggle("collapsed", !explorerOpen);
  explorerToggleButton.setAttribute("aria-expanded", String(explorerOpen));
}
autoSizeComposer();
renderChangesView();
renderCommandsView();
updateControls();
