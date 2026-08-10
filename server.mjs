import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueSerialTask } from "./public/session-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fileAccessRoots = new Map();

let SERVER_CONFIG = null;
let HOST = null;
let PORT = null;
let CODEX_BIN = null;
let DEFAULT_CWD = null;
let fullRequestHandler = null;
let activeWss = null;
let activeRuntimeManager = null;
let WebSocketImpl = null;
let startupFailed = false;
const pendingUpgrades = [];
const SNAPSHOT_REASON_ACTIVE_WRITER = "active_writer";

const STATIC_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const STATIC_ROOTS = [
  { prefix: "/vendor/marked", root: path.join(__dirname, "node_modules", "marked") },
  { prefix: "/vendor/dompurify", root: path.join(__dirname, "node_modules", "dompurify") },
  { prefix: "/vendor/katex", root: path.join(__dirname, "node_modules", "katex") },
  { prefix: "/vendor/lucide", root: path.join(__dirname, "node_modules", "lucide") },
  { prefix: "", root: path.join(__dirname, "public") },
];

function sendEarlyJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}

function nonEmpty(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function resolveConfiguredPath(value, rootDir, bareCommand = false) {
  if (!value) return value;
  if (bareCommand && !value.startsWith(".") && !/[\\/]/.test(value)) return value;
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function startupConfigPath(rootDir, env) {
  const configured = nonEmpty(env.CODEX_WEB_CONFIG);
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
  for (const name of ["config.yaml", "config.yml", "config.json"]) {
    const candidate = path.join(rootDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(rootDir, "config.json");
}

function parseSimpleStartupConfig(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: {} };
    return null;
  }
  if (path.extname(configPath).toLowerCase() === ".json") {
    try {
      const value = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value)
        ? { exists: true, value }
        : null;
    } catch {
      return null;
    }
  }

  const value = {};
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (sourceLine !== line) return null;
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return null;
    let raw = line.slice(separator + 1).trim();
    if (raw.startsWith("'") || raw.startsWith('"')) {
      const quote = raw[0];
      let closeIndex = -1;
      for (let index = 1; index < raw.length; index += 1) {
        if (quote === "'" && raw[index] === "'") {
          if (raw[index + 1] === "'") {
            index += 1;
          } else {
            closeIndex = index;
            break;
          }
        } else if (quote === '"' && raw[index] === '"' && raw[index - 1] !== "\\") {
          closeIndex = index;
          break;
        }
      }
      const trailing = raw.slice(closeIndex + 1);
      if (closeIndex < 0 || (trailing.trim() && !/^\s+#/.test(trailing))) {
        return null;
      }
      const quoted = raw.slice(0, closeIndex + 1);
      if (quote === "'") {
        raw = quoted.slice(1, -1).replaceAll("''", "'");
      } else {
        try {
          raw = JSON.parse(quoted);
        } catch {
          return null;
        }
      }
    } else {
      raw = raw.replace(/\s+#.*$/, "").trim();
      if (raw.startsWith("[") || raw.startsWith("{") || raw.startsWith("|") || raw.startsWith(">") || raw.startsWith("&") || raw.startsWith("*") || raw.startsWith("!")) return null;
      if (["null", "~"].includes(raw.toLowerCase())) raw = null;
    }
    value[key] = raw;
  }
  return { exists: true, value };
}

function loadStartupConfig(rootDir, env = process.env) {
  const configPath = startupConfigPath(rootDir, env);
  const loaded = parseSimpleStartupConfig(configPath);
  if (!loaded) return null;
  const fileConfig = loaded.value;
  const configValue = (...keys) => keys.map((key) => nonEmpty(fileConfig?.[key])).find(Boolean) || null;
  const codexBin = nonEmpty(env.CODEX_BIN) || configValue("codexBin", "codex_bin") || "codex";
  const projectCwd = nonEmpty(env.PROJECT_CWD) || configValue("projectCwd", "project_cwd") || process.cwd();
  const host = nonEmpty(env.HOST) || configValue("host") || "127.0.0.1";
  const portText = nonEmpty(env.PORT) || configValue("port") || "4317";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    configPath,
    configExists: loaded.exists,
    codexBin: resolveConfiguredPath(codexBin, rootDir, true),
    projectCwd: resolveConfiguredPath(projectCwd, rootDir),
    host,
    port,
  };
}

function earlyStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").includes("..")) return null;
  const match = STATIC_ROOTS.find(({ prefix }) => prefix && (decoded === prefix || decoded.startsWith(prefix + "/")))
    || STATIC_ROOTS.at(-1);
  const relative = match.prefix ? decoded.slice(match.prefix.length) : decoded;
  const relativePath = relative === "/" || relative === "" ? "index.html" : relative.slice(1);
  const candidate = path.resolve(match.root, relativePath);
  const root = path.resolve(match.root);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

function handleEarlyRequest(req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/healthz") {
    sendEarlyJson(res, startupFailed ? 503 : 200, startupFailed
      ? { ok: false, error: "Codex Web backend failed to start", code: "SERVER_STARTUP_FAILED" }
      : { ok: true });
    return;
  }
  if (requestUrl.pathname === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    res.setHeader("Retry-After", "1");
    sendEarlyJson(res, 503, {
      error: "Codex Web backend is still starting",
      code: "SERVER_STARTING",
    });
    return;
  }
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    sendEarlyJson(res, 503, { error: "Codex Web backend is still starting", code: "SERVER_STARTING" });
    return;
  }
  const filePath = earlyStaticPath(requestUrl.pathname);
  if (!filePath) {
    sendEarlyJson(res, 404, { error: "Not found", code: "NOT_FOUND" });
    return;
  }
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendEarlyJson(res, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", STATIC_CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
    res.setHeader("Content-Length", String(stats.size));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).on("error", () => {
      if (!res.headersSent) sendEarlyJson(res, 500, { error: "Unable to read static asset", code: "STATIC_READ_ERROR" });
      else res.destroy();
    }).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (fullRequestHandler) {
    fullRequestHandler(req, res);
    return;
  }
  handleEarlyRequest(req, res);
});

function upgradePath(req) {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
}

function handleUpgrade(req, socket, head) {
  if (upgradePath(req) !== "/ws") {
    socket.destroy();
    return;
  }
  if (!activeWss) {
    pendingUpgrades.push({ req, socket, head });
    socket.once("close", () => {
      const index = pendingUpgrades.findIndex((entry) => entry.socket === socket);
      if (index >= 0) pendingUpgrades.splice(index, 1);
    });
    socket.setTimeout(15_000, () => socket.destroy());
    return;
  }
  activeWss.handleUpgrade(req, socket, head, (ws) => activeWss.emit("connection", ws, req));
}

server.on("upgrade", handleUpgrade);

function sendJson(ws, payload) {
  if (WebSocketImpl && ws.readyState === WebSocketImpl.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function compactError(error) {
  const data = error?.code === "READ_ONLY_SNAPSHOT"
    ? { reason: error?.data?.reason || SNAPSHOT_REASON_ACTIVE_WRITER }
    : error?.data;
  return {
    message: error?.message || String(error),
    code: error?.code,
    data,
  };
}

function turnBridgeRequestId(command) {
  const value = String(command?.requestId || "").trim();
  return value || randomUUID();
}

function turnBridgeError(message, code = "INVALID_TURN_REQUEST", data = undefined) {
  const error = new Error(message);
  error.code = code;
  error.data = data;
  return error;
}

function normalizeThreadId(value) {
  const threadId = String(value || "").trim();
  return threadId || null;
}

function captureThreadTarget(command, selectedThreadId, {
  required = true,
  allowDifferent = false,
} = {}) {
  const requestedThreadId = normalizeThreadId(command?.threadId);
  if (requestedThreadId && selectedThreadId && requestedThreadId !== selectedThreadId && !allowDifferent) {
    throw turnBridgeError("Thread is stale or no longer active", "STALE_THREAD", {
      expectedThreadId: selectedThreadId,
      receivedThreadId: requestedThreadId,
    });
  }
  const targetThreadId = requestedThreadId || selectedThreadId || null;
  if (required && !targetThreadId) throw new Error("Start or resume a thread first");
  return targetThreadId;
}

const THREAD_SCOPED_COMMANDS = new Set([
  "updateSettings",
  "resumeThread",
  "refreshThreadSnapshot",
  "forkThread",
  "sendMessage",
  "steerMessage",
  "steer",
  "interrupt",
  "renameThread",
  "archiveThread",
  "deleteThread",
  "reviewThread",
  "getGoal",
  "setGoal",
  "clearGoal",
  "setMemoryMode",
  "listBackgroundTerminals",
  "cleanBackgroundTerminals",
  "listMcp",
  "reloadMcp",
  "listApps",
  "compact",
  "approveGuardianDeniedAction",
  "setExperiment",
  "approval",
  "serverRequestResponse",
]);

function getDataList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.models)) return result.models;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function initializeFullServer({
  expressModule,
  wsModule,
  runtimeModule,
  fileAccessModule,
  threadDeleteModule,
  threadAccessModule,
}) {
  const express = expressModule.default || expressModule;
  const { WebSocketServer, WebSocket } = wsModule;
  const {
    FileAccessError,
    listWorkspaceDirectory,
    readWorkspaceImage,
    readWorkspaceText,
  } = fileAccessModule;
  const { resolveDeleteThreadId } = threadDeleteModule;
  const {
    createSnapshotAccessMetadata,
    resumeThreadWithFallback,
    SNAPSHOT_REASON_ACTIVE_WRITER,
  } = threadAccessModule;
  const { CodexRuntimeManager, isThreadRuntimeRunning } = runtimeModule;

  WebSocketImpl = WebSocket;
  const app = express();
  const wss = new WebSocketServer({ noServer: true });
  const runtimeManager = new CodexRuntimeManager({
    codexBin: CODEX_BIN,
    cwd: DEFAULT_CWD,
    env: process.env,
  });
  activeWss = wss;
  activeRuntimeManager = runtimeManager;

  app.disable("x-powered-by");
  app.get("/api/files", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = String(req.get("X-Codex-File-Token") || "").trim();
    const root = token ? fileAccessRoots.get(token) : null;
    if (!root) {
      res.status(401).json({ error: "File access token is missing or expired", code: "INVALID_FILE_TOKEN" });
      return;
    }

    const type = String(req.query.type || "list");
    const relativePath = String(req.query.path || "");
    try {
      if (type === "list") {
        res.json(await listWorkspaceDirectory(root, relativePath));
        return;
      }
      if (type === "text") {
        res.json(await readWorkspaceText(root, relativePath));
        return;
      }
      if (type === "raw") {
        const file = await readWorkspaceImage(root, relativePath);
        res.setHeader("Content-Type", file.mime);
        res.setHeader("Content-Length", String(file.size));
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(file.content);
        return;
      }
      res.status(400).json({ error: "Unsupported file request type", code: "INVALID_FILE_REQUEST" });
    } catch (error) {
      if (error instanceof FileAccessError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      console.error("File API failed", error);
      res.status(500).json({ error: "Unable to read the requested file", code: "FILE_ACCESS_ERROR" });
    }
  });
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/vendor/marked", express.static(path.join(__dirname, "node_modules", "marked")));
  app.use("/vendor/dompurify", express.static(path.join(__dirname, "node_modules", "dompurify")));
  app.use("/vendor/katex", express.static(path.join(__dirname, "node_modules", "katex")));
  app.use("/vendor/lucide", express.static(path.join(__dirname, "node_modules", "lucide")));
  app.get("/favicon.ico", (_req, res) => res.status(204).end());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  wss.on("connection", (ws) => {
  const clientId = runtimeManager.addClient((payload) => sendJson(ws, payload));
  const fileAccessToken = randomUUID();
  fileAccessRoots.set(fileAccessToken, DEFAULT_CWD);
  let initialized = false;
  let activeThreadId = null;
  let activeTurnId = null;
  let activeWriterConflict = null;
  let activeAccessMode = null;
  let snapshotAt = null;
  let snapshotReason = null;
  let activeFileSearchSessionId = null;
  let pendingTurnSettings = {};
  const settingsUpdateQueues = new Map();
  let lastThreadResponse = null;
  let threadContextScope = 0;
  let threadTransitionScope = null;
  const pendingServerRequests = {
    get: (requestId) => runtimeManager.getPendingServerRequest(requestId),
    delete: (requestId) => runtimeManager.dropServerRequest(requestId),
  };

  function setAccessMetadata(metadata = {}) {
    activeAccessMode = metadata.accessMode || null;
    snapshotAt = activeAccessMode === "snapshot" ? metadata.snapshotAt || null : null;
    snapshotReason = activeAccessMode === "snapshot" ? metadata.snapshotReason || null : null;
  }

  function setFileAccessRoot(value) {
    const cwd = typeof value === "string"
      ? value
      : value?.thread?.cwd || value?.cwd;
    fileAccessRoots.set(fileAccessToken, String(cwd || DEFAULT_CWD));
  }

  function clearActiveThread() {
    threadContextScope += 1;
    threadTransitionScope = null;
    activeThreadId = null;
    activeTurnId = null;
    activeWriterConflict = null;
    setAccessMetadata();
    lastThreadResponse = null;
    setFileAccessRoot(DEFAULT_CWD);
  }

  function syncSelectedRuntime() {
    const runtime = runtimeManager.getRuntime(activeThreadId);
    if (!runtime) return;
    activeTurnId = runtime.activeTurnId || null;
    activeWriterConflict = runtime.writerConflict || null;
    setAccessMetadata(runtime);
    pendingTurnSettings = { ...(runtime.pendingTurnSettings || {}) };
    lastThreadResponse = runtime.latestThreadResponse || lastThreadResponse;
    if (lastThreadResponse) setFileAccessRoot(lastThreadResponse);
  }

  function readOnlySnapshotError(threadId = activeThreadId) {
    const runtime = runtimeManager.getRuntime(threadId);
    const error = new Error("Thread is read-only while another Codex client controls it");
    error.code = "READ_ONLY_SNAPSHOT";
    error.data = {
      reason: runtime?.snapshotReason || (threadId === activeThreadId ? snapshotReason : null) || SNAPSHOT_REASON_ACTIVE_WRITER,
    };
    return error;
  }

  function ensureThreadWritable(threadId = activeThreadId) {
    ensureNoThreadTransition();
    const runtime = runtimeManager.getRuntime(threadId);
    const accessMode = runtime?.accessMode || (threadId === activeThreadId ? activeAccessMode : null);
    const writerConflict = runtime?.writerConflict || (threadId === activeThreadId ? activeWriterConflict : null);
    if (accessMode === "snapshot" || writerConflict) {
      throw readOnlySnapshotError(threadId);
    }
  }

  function ensureThreadDeletable(threadId) {
    const runtime = runtimeManager.getRuntime(threadId);
    if (!isThreadRuntimeRunning(runtime)) return;
    const error = new Error("Cannot delete a Thread while its Turn is running");
    error.code = "THREAD_RUNNING";
    error.data = {
      threadId,
      running: Boolean(runtime.running),
      activeTurnId: runtime.activeTurnId || null,
    };
    throw error;
  }

  function staleThreadContextError() {
    const error = new Error("Thread context changed before the App Server response arrived");
    error.code = "STALE_THREAD_CONTEXT";
    return error;
  }

  function beginThreadTransition() {
    if (threadTransitionScope !== null) {
      const error = new Error("Another thread transition is already in progress");
      error.code = "THREAD_TRANSITION_PENDING";
      throw error;
    }
    threadContextScope += 1;
    threadTransitionScope = threadContextScope;
    return { scope: threadContextScope };
  }

  function endThreadTransition(scope) {
    if (threadTransitionScope === scope) threadTransitionScope = null;
  }

  function ensureNoThreadTransition() {
    if (threadTransitionScope !== null) {
      const error = new Error("Another thread transition is already in progress");
      error.code = "THREAD_TRANSITION_PENDING";
      throw error;
    }
  }

  function request(method, params = {}, {
    scope = threadContextScope,
    contextBound = true,
    threadId: explicitThreadId = null,
  } = {}) {
    const threadId = explicitThreadId || params?.threadId || activeThreadId;
    return runtimeManager.request(method, params, {
      clientId,
      scope,
      threadId,
    }).then((result) => {
      if (contextBound && scope !== threadContextScope) throw staleThreadContextError();
      return result;
    });
  }

  async function safeRequest(method, params = {}) {
    try {
      return { ok: true, result: await request(method, params) };
    } catch (error) {
      return { ok: false, error: compactError(error) };
    }
  }

  async function runFileSearch(query, cwd) {
    const sessionId = randomUUID();
    const previousSessionId = activeFileSearchSessionId;
    activeFileSearchSessionId = sessionId;
    sendJson(ws, { type: "fileSearchStarted", query, sessionId });

    if (previousSessionId && previousSessionId !== sessionId) {
      await safeRequest("fuzzyFileSearch/sessionStop", { sessionId: previousSessionId });
    }
    if (activeFileSearchSessionId !== sessionId) return;

    try {
      await request("fuzzyFileSearch/sessionStart", { sessionId, roots: [cwd] });
      if (activeFileSearchSessionId !== sessionId) return;
      await request("fuzzyFileSearch/sessionUpdate", { sessionId, query });
    } catch (error) {
      if (activeFileSearchSessionId !== sessionId) return;

      // Keep older App Server builds usable. The current protocol streams the
      // session notifications; older builds can still answer the one-shot RPC.
      await safeRequest("fuzzyFileSearch/sessionStop", { sessionId });
      const fallback = await safeRequest("fuzzyFileSearch", { query, roots: [cwd] });
      if (fallback.ok) {
        sendJson(ws, { type: "fileSearchResult", query, sessionId, result: fallback.result });
      } else {
        sendJson(ws, {
          type: "fileSearchError",
          query,
          sessionId,
          error: fallback.error || compactError(error),
        });
      }
    }
  }

  const runtimeListener = ({ threadId, runtime, deleted }) => {
    if (threadId !== activeThreadId) return;
    if (deleted) {
      clearActiveThread();
      return;
    }
    syncSelectedRuntime();
  };
  runtimeManager.on("runtimeUpdate", runtimeListener);

  async function fetchMetadata(cwd = DEFAULT_CWD, threadId = null) {
    const [models, config, account, permissionProfiles, experiments, collaborationModes] = await Promise.all([
      safeRequest("model/list", { includeHidden: false }),
      safeRequest("config/read", {}),
      safeRequest("account/read", { refreshToken: false }),
      safeRequest("permissionProfile/list", { cwd }),
      safeRequest("experimentalFeature/list", threadId ? { threadId } : {}),
      safeRequest("collaborationMode/list", {}),
    ]);

    return {
      models: models.ok ? getDataList(models.result) : [],
      config: config.ok ? config.result : null,
      account: account.ok ? account.result : null,
      permissionProfiles: permissionProfiles.ok ? getDataList(permissionProfiles.result) : [],
      experiments: experiments.ok ? getDataList(experiments.result) : [],
      collaborationModes: collaborationModes.ok ? getDataList(collaborationModes.result) : [],
      metadataErrors: {
        models: models.ok ? null : models.error,
        config: config.ok ? null : config.error,
        account: account.ok ? null : account.error,
        permissionProfiles: permissionProfiles.ok ? null : permissionProfiles.error,
        experiments: experiments.ok ? null : experiments.error,
        collaborationModes: collaborationModes.ok ? null : collaborationModes.error,
      },
    };
  }

  async function fetchRecentThreads(cursor = null, searchTerm = null) {
    const params = {
      archived: false,
      cursor,
      limit: 50,
      sortKey: "recency_at",
      sortDirection: "desc",
    };
    if (String(searchTerm || "").trim()) params.searchTerm = String(searchTerm).trim();
    return safeRequest("thread/list", params);
  }

  function browserUserInput(command) {
    const source = Array.isArray(command.input)
      ? command.input
      : [{ type: "text", text: String(command.text || "") }];
    const images = source.filter((part) => part?.type === "image");
    if (images.length > 4) throw new Error("Attach at most 4 images");
    const input = source.map((part) => {
      if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
        return { type: "text", text: part.text };
      }
      if (part?.type === "mention" && typeof part.name === "string" && typeof part.path === "string" && part.path) {
        return { type: "mention", name: part.name, path: part.path };
      }
      if (part?.type === "image" && typeof part.url === "string" && part.url.startsWith("data:image/")) {
        if (part.url.length > 14_000_000) throw new Error("Each image must be 10 MB or smaller");
        return { type: "image", url: part.url };
      }
      throw new Error(`Unsupported or invalid message input: ${part?.type || "unknown"}`);
    });
    if (!input.length) throw new Error("Message cannot be empty");
    return input;
  }

  async function initialize() {
    const serverInfo = await runtimeManager.initialize();
    initialized = true;
    // Start the expensive sidebar query alongside metadata, but keep it out of
    // the ready gate.  The browser can resume a saved Thread as soon as the
    // metadata contract is available; the list is delivered on its existing
    // asynchronous threadList channel below.
    const recentThreadsPromise = fetchRecentThreads();
    const metadata = await fetchMetadata(DEFAULT_CWD);

    sendJson(ws, {
      type: "ready",
      defaultCwd: DEFAULT_CWD,
      fileAccessToken,
      fileAccessCwd: DEFAULT_CWD,
      serverInfo,
      runtimeSnapshot: runtimeManager.runtimeSnapshot(),
      ...metadata,
      threadListPending: true,
    });

    const recentThreads = await recentThreadsPromise;
    sendJson(ws, {
      type: "threadList",
      append: false,
      result: recentThreads.ok ? recentThreads.result : null,
      error: recentThreads.ok ? null : recentThreads.error,
    });
  }

  initialize().catch((error) => {
    sendJson(ws, { type: "bridgeError", message: error.message });
  });

  async function updateThreadSettings(command, selectedThreadId, requestScope = threadContextScope) {
    const targetThreadId = captureThreadTarget(command, selectedThreadId);
    ensureThreadWritable(targetThreadId);

    const requested = {};
    if (command.model !== undefined) requested.model = command.model || null;
    if (command.effort !== undefined) requested.effort = command.effort || null;
    if (command.serviceTier !== undefined) requested.serviceTier = command.serviceTier || null;
    if (command.cwd !== undefined) requested.cwd = command.cwd || null;
    if (command.permissions !== undefined) requested.permissions = command.permissions || null;
    if (command.personality !== undefined) requested.personality = command.personality || null;
    if (command.collaborationMode !== undefined) requested.collaborationMode = command.collaborationMode;
    const parsedSettingsRevision = Number(command.settingsRevision);
    const settingsRevision = Number.isSafeInteger(parsedSettingsRevision) && parsedSettingsRevision >= 0
      ? parsedSettingsRevision
      : null;

    try {
      const result = await request("thread/settings/update", {
        threadId: targetThreadId,
        ...requested,
      }, { scope: requestScope });
      pendingTurnSettings = {};
      runtimeManager.setPendingTurnSettings(targetThreadId, pendingTurnSettings);
      if (requested.cwd) setFileAccessRoot(requested.cwd);
      sendJson(ws, {
        type: "settingsUpdateAccepted",
        threadId: targetThreadId,
        mode: "thread",
        settingsRevision,
        requested,
        result,
      });
    } catch (error) {
      if (error?.code === "STALE_THREAD_CONTEXT") throw error;
      pendingTurnSettings = { ...pendingTurnSettings, ...requested };
      runtimeManager.setPendingTurnSettings(targetThreadId, pendingTurnSettings);
      sendJson(ws, {
        type: "settingsUpdateAccepted",
        threadId: targetThreadId,
        mode: "nextTurnFallback",
        settingsRevision,
        requested,
        warning: error.message,
      });
    }
  }

  function enqueueThreadSettingsUpdate(command, selectedThreadId, requestScope = threadContextScope) {
    const targetThreadId = captureThreadTarget(command, selectedThreadId);
    return enqueueSerialTask(
      settingsUpdateQueues,
      targetThreadId,
      () => updateThreadSettings(command, selectedThreadId, requestScope),
    );
  }

  ws.on("message", async (data) => {
    let command;
    try {
      command = JSON.parse(data.toString());
    } catch {
      sendJson(ws, { type: "bridgeError", message: "Invalid browser message" });
      return;
    }

    const selectedThreadAtDispatch = activeThreadId;
    const requestedThreadAtDispatch = normalizeThreadId(command.threadId);
    const responseThreadId = requestedThreadAtDispatch || selectedThreadAtDispatch || null;

    try {
      if (!initialized && command.type !== "approval") {
        throw new Error("Codex app-server is not initialized yet");
      }

      switch (command.type) {
        case "listThreads": {
          const listed = await fetchRecentThreads(command.cursor || null, command.searchTerm || null);
          sendJson(ws, {
            type: "threadList",
            append: Boolean(command.cursor),
            result: listed.ok ? listed.result : null,
            error: listed.ok ? null : listed.error,
          });
          break;
        }

        case "searchFiles": {
          const query = String(command.query || "").trim();
          const cwd = String(command.cwd || lastThreadResponse?.thread?.cwd || DEFAULT_CWD);
          if (!query) {
            const previousSessionId = activeFileSearchSessionId;
            activeFileSearchSessionId = null;
            if (previousSessionId) {
              await safeRequest("fuzzyFileSearch/sessionStop", { sessionId: previousSessionId });
            }
            sendJson(ws, { type: "fileSearchResult", query, result: { files: [] } });
          } else {
            await runFileSearch(query, cwd);
          }
          break;
        }

        case "stopFileSearch": {
          const sessionId = String(command.sessionId || activeFileSearchSessionId || "").trim();
          if (sessionId && sessionId === activeFileSearchSessionId) activeFileSearchSessionId = null;
          if (sessionId) await safeRequest("fuzzyFileSearch/sessionStop", { sessionId });
          break;
        }

        case "refreshMetadata": {
          const cwd = String(command.cwd || DEFAULT_CWD);
          const metadata = await fetchMetadata(cwd);
          setFileAccessRoot(cwd);
          sendJson(ws, { type: "metadata", fileAccessCwd: cwd, ...metadata });
          break;
        }

        case "startThread": {
          const transition = beginThreadTransition();
          try {
            const cwd = String(command.cwd || DEFAULT_CWD);
            const params = { cwd };
            if (command.model) params.model = String(command.model);
            if (command.serviceTier) params.serviceTier = String(command.serviceTier);
            if (command.effort) {
              params.config = { model_reasoning_effort: String(command.effort) };
            }
            if (command.sessionStartSource) params.sessionStartSource = String(command.sessionStartSource);
            if (command.approvalPolicy) params.approvalPolicy = command.approvalPolicy;
            if (command.permissions) params.permissions = command.permissions;
            else if (command.sandbox) params.sandbox = command.sandbox;

            const result = await request("thread/start", params, transition);
            const startedThreadId = normalizeThreadId(result.thread?.id);
            if (!startedThreadId) throw new Error("App Server did not return a thread id");
            activeThreadId = startedThreadId;
            activeTurnId = null;
            activeWriterConflict = null;
            setAccessMetadata({ accessMode: "live" });
            // `thread/start` does not accept collaborationMode in the current
            // protocol. Keep the selected preset for the first turn instead of
            // dropping it or sending an invalid parameter to App Server.
            pendingTurnSettings = command.collaborationMode !== undefined
              ? { collaborationMode: command.collaborationMode }
              : {};
            lastThreadResponse = result;
            setFileAccessRoot(result);
            runtimeManager.registerThread(result, {
              accessMode: "live",
              activeTurnId,
              pendingTurnSettings,
            });
            sendJson(ws, {
              type: "threadReady",
              mode: "start",
              operation: "start",
              ...result,
              threadId: startedThreadId,
              accessMode: activeAccessMode,
              snapshotAt,
              snapshotReason,
            });
          } finally {
            endThreadTransition(transition.scope);
          }
          break;
        }

        case "resumeThread": {
          const threadId = captureThreadTarget(command, selectedThreadAtDispatch, {
            allowDifferent: true,
          });
          if (!threadId) throw new Error("threadId is required");
          const transition = beginThreadTransition();
          try {
            const knownRuntime = runtimeManager.getRuntime(threadId);
            const knownActiveTurnId = knownRuntime?.activeTurnId || null;
            const knownPendingTurnSettings = { ...(knownRuntime?.pendingTurnSettings || {}) };
            const resumed = knownRuntime
              ? {
                result: await request("thread/read", { threadId, includeTurns: true }, transition),
                writerConflict: knownRuntime.writerConflict || null,
                accessMode: knownRuntime.accessMode || "live",
                snapshotAt: knownRuntime.snapshotAt || null,
                snapshotReason: knownRuntime.snapshotReason || null,
              }
              : await resumeThreadWithFallback(
                (method, params) => request(method, params, transition),
                threadId,
              );
            const {
              result,
              writerConflict,
              accessMode,
              snapshotAt: resumedSnapshotAt,
              snapshotReason: resumedSnapshotReason,
            } = resumed;
            const resumedThreadId = normalizeThreadId(result.thread?.id);
            if (!resumedThreadId || resumedThreadId !== threadId) {
              throw turnBridgeError("App Server returned a different Thread", "THREAD_RESPONSE_MISMATCH", {
                expectedThreadId: threadId,
                receivedThreadId: resumedThreadId,
              });
            }
            activeThreadId = resumedThreadId;
            activeTurnId = knownActiveTurnId;
            activeWriterConflict = writerConflict || null;
            setAccessMetadata({
              accessMode,
              snapshotAt: resumedSnapshotAt,
              snapshotReason: resumedSnapshotReason,
            });
            pendingTurnSettings = knownPendingTurnSettings;
            lastThreadResponse = result;
            setFileAccessRoot(result);
            runtimeManager.registerThread(result, {
              accessMode,
              writerConflict,
              snapshotAt: resumedSnapshotAt,
              snapshotReason: resumedSnapshotReason,
              activeTurnId,
              pendingTurnSettings,
            });
            sendJson(ws, {
              type: "threadReady",
              mode: "resume",
              operation: accessMode === "snapshot" ? "snapshot" : "resume",
              ...result,
              threadId,
              accessMode: activeAccessMode,
              snapshotAt,
              snapshotReason,
            });
          } finally {
            endThreadTransition(transition.scope);
          }
          break;
        }

        case "refreshThreadSnapshot": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          const targetAccessMode = runtimeManager.getRuntime(targetThreadId)?.accessMode
            || (targetThreadId === selectedThreadAtDispatch ? activeAccessMode : null);
          if (targetAccessMode !== "snapshot") {
            throw new Error("Thread is not in snapshot mode");
          }
          const transition = beginThreadTransition();
          try {
            const result = await request("thread/read", {
              threadId: targetThreadId,
              includeTurns: true,
            }, transition);
            const refreshed = createSnapshotAccessMetadata();
            setAccessMetadata(refreshed);
            activeTurnId = null;
            lastThreadResponse = result;
            setFileAccessRoot(result);
            runtimeManager.registerThread(result, {
              accessMode: "snapshot",
              snapshotAt,
              snapshotReason,
              activeTurnId: null,
            });
            sendJson(ws, {
              type: "threadReady",
              mode: "snapshot",
              operation: "snapshot",
              ...result,
              threadId: targetThreadId,
              accessMode: activeAccessMode,
              snapshotAt,
              snapshotReason,
            });
          } finally {
            endThreadTransition(transition.scope);
          }
          break;
        }

        case "forkThread": {
          const sourceThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          const transition = beginThreadTransition();
          try {
            const result = await request("thread/fork", { threadId: sourceThreadId }, transition);
            const forkedThreadId = normalizeThreadId(result.thread?.id);
            if (!forkedThreadId) throw new Error("App Server did not return a forked thread id");
            activeThreadId = forkedThreadId;
            activeTurnId = null;
            activeWriterConflict = null;
            setAccessMetadata({ accessMode: "live" });
            pendingTurnSettings = {};
            lastThreadResponse = result;
            setFileAccessRoot(result);
            runtimeManager.registerThread(result, {
              accessMode: "live",
              activeTurnId: null,
              pendingTurnSettings,
            });
            sendJson(ws, {
              type: "threadReady",
              mode: "fork",
              operation: "fork",
              ...result,
              threadId: forkedThreadId,
              accessMode: activeAccessMode,
              snapshotAt,
              snapshotReason,
            });
          } finally {
            endThreadTransition(transition.scope);
          }
          break;
        }

        case "updateSettings": {
          await enqueueThreadSettingsUpdate(command, selectedThreadAtDispatch, threadContextScope);
          break;
        }

        case "sendMessage": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          const requestId = turnBridgeRequestId(command);
          ensureThreadWritable(targetThreadId);
          const input = browserUserInput(command);

          const params = {
            threadId: targetThreadId,
            clientUserMessageId: String(command.clientUserMessageId || "").trim() || randomUUID(),
            input,
          };

          const requested = {
            ...(runtimeManager.getRuntime(targetThreadId)?.pendingTurnSettings
              || (targetThreadId === selectedThreadAtDispatch ? pendingTurnSettings : {})),
          };
          if (command.model) requested.model = command.model;
          if (command.effort) requested.effort = command.effort;
          if (command.serviceTier !== undefined) requested.serviceTier = command.serviceTier;
          if (command.permissions !== undefined) requested.permissions = command.permissions;
          if (command.personality !== undefined) requested.personality = command.personality;
          if (command.collaborationMode !== undefined) requested.collaborationMode = command.collaborationMode;
          if (requested.model) params.model = requested.model;
          if (requested.effort) params.effort = requested.effort;
          if (requested.serviceTier) params.serviceTier = requested.serviceTier;
          if (requested.permissions) params.permissions = requested.permissions;
          if (requested.personality) params.personality = requested.personality;
          if (requested.collaborationMode) params.collaborationMode = requested.collaborationMode;

          const result = await request("turn/start", params);
          const acceptedTurnId = normalizeThreadId(result.turn?.id)
            || runtimeManager.getRuntime(targetThreadId)?.activeTurnId
            || null;
          activeTurnId = acceptedTurnId;
          pendingTurnSettings = {};
          runtimeManager.updateRuntime(targetThreadId, {
            activeTurnId: acceptedTurnId,
            running: true,
            status: "active",
            pendingTurnSettings: {},
          });
          sendJson(ws, { type: "turnAccepted", requestId, accepted: true, ...result, threadId: targetThreadId });
          break;
        }

        case "steerMessage":
        case "steer": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const requestId = turnBridgeRequestId(command);
          const expectedTurnId = String(command.expectedTurnId || "").trim();
          const targetTurnId = runtimeManager.getRuntime(targetThreadId)?.activeTurnId
            || (targetThreadId === selectedThreadAtDispatch ? activeTurnId : null);
          if (!expectedTurnId || !targetTurnId || expectedTurnId !== targetTurnId) {
            throw turnBridgeError("The active turn changed before steering was accepted", "STALE_TURN", {
              expectedTurnId: targetTurnId,
              receivedTurnId: expectedTurnId || null,
            });
          }
          const input = browserUserInput(command);
          const params = {
            threadId: targetThreadId,
            expectedTurnId,
            clientUserMessageId: String(command.clientUserMessageId || "").trim() || randomUUID(),
            input,
          };
          const result = await request("turn/steer", params);
          sendJson(ws, { type: "steerAccepted", requestId, accepted: true, ...result, threadId: targetThreadId });
          break;
        }

        case "interrupt": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch, {
            allowDifferent: true,
          });
          const targetRuntime = runtimeManager.getRuntime(targetThreadId);
          const turnId = String(command.turnId || targetRuntime?.activeTurnId || (targetThreadId === selectedThreadAtDispatch ? activeTurnId : "")).trim();
          ensureThreadWritable(targetThreadId);
          if (!turnId) throw new Error("No active turn to interrupt");
          await request("turn/interrupt", { threadId: targetThreadId, turnId }, {
            contextBound: targetThreadId === selectedThreadAtDispatch,
          });
          sendJson(ws, { type: "interruptAccepted", threadId: targetThreadId, turnId });
          break;
        }

        case "renameThread": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const name = String(command.name || "").trim();
          if (!name) throw new Error("Thread name is required");
          const result = await request("thread/name/set", { threadId: targetThreadId, name });
          sendJson(ws, { type: "threadRenamed", threadId: targetThreadId, name, result });
          break;
        }

        case "archiveThread": {
          const threadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(threadId);
          const result = await request("thread/archive", { threadId });
          runtimeManager.forgetThread(threadId);
          clearActiveThread();
          sendJson(ws, { type: "threadArchived", threadId, result });
          break;
        }

        case "deleteThread": {
          const threadId = normalizeThreadId(resolveDeleteThreadId(command.threadId));
          if (!threadId) throw new Error("threadId is required");
          // A snapshot only locks mutations to the selected thread. Deleting
          // a different sidebar entry does not take ownership of that thread.
          ensureThreadDeletable(threadId);
          ensureThreadWritable(threadId);
          const wasSelectedAtDispatch = threadId === selectedThreadAtDispatch;
          const requestId = String(command.requestId || "").trim() || null;
          const result = await request("thread/delete", { threadId }, {
            contextBound: threadId === selectedThreadAtDispatch,
          });
          if (wasSelectedAtDispatch) {
            runtimeManager.forgetThread(threadId);
            clearActiveThread();
          }
          sendJson(ws, { type: "threadDeleted", threadId, requestId, result });
          break;
        }

        case "reviewThread": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const instructions = String(command.instructions || "").trim();
          const target = instructions
            ? { type: "custom", instructions }
            : { type: "uncommittedChanges" };
          const result = await request("review/start", {
            threadId: targetThreadId,
            delivery: "inline",
            target,
          });
          const acceptedTurnId = normalizeThreadId(result.turn?.id)
            || runtimeManager.getRuntime(targetThreadId)?.activeTurnId
            || null;
          activeTurnId = acceptedTurnId;
          runtimeManager.updateRuntime(targetThreadId, {
            activeTurnId: acceptedTurnId,
            running: true,
            status: "active",
          });
          sendJson(ws, { type: "reviewAccepted", ...result, threadId: targetThreadId });
          break;
        }

        case "getGoal": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          const result = await request("thread/goal/get", { threadId: targetThreadId });
          sendJson(ws, { type: "goalResult", threadId: targetThreadId, action: "get", result });
          break;
        }

        case "setGoal": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const objective = String(command.objective || "").trim();
          if (!objective) throw new Error("Goal objective is required");
          const result = await request("thread/goal/set", {
            threadId: targetThreadId,
            objective,
            status: "active",
          });
          sendJson(ws, { type: "goalResult", threadId: targetThreadId, action: "set", result });
          break;
        }

        case "clearGoal": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const result = await request("thread/goal/clear", { threadId: targetThreadId });
          sendJson(ws, { type: "goalResult", threadId: targetThreadId, action: "clear", result });
          break;
        }

        case "setMemoryMode": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const mode = command.mode === "disabled" ? "disabled" : "enabled";
          const result = await request("thread/memoryMode/set", { threadId: targetThreadId, mode });
          sendJson(ws, { type: "memoryModeUpdated", threadId: targetThreadId, mode, result });
          break;
        }

        case "listBackgroundTerminals": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          const result = await request("thread/backgroundTerminals/list", { threadId: targetThreadId });
          sendJson(ws, { type: "backgroundTerminalsResult", threadId: targetThreadId, result });
          break;
        }

        case "cleanBackgroundTerminals": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const result = await request("thread/backgroundTerminals/clean", { threadId: targetThreadId });
          sendJson(ws, { type: "backgroundTerminalsCleaned", threadId: targetThreadId, result });
          break;
        }

        case "logout": {
          const result = await request("account/logout", {});
          sendJson(ws, { type: "loggedOut", result });
          break;
        }

        case "listMcp": {
          const targetThreadId = command.threadId
            ? captureThreadTarget(command, selectedThreadAtDispatch)
            : selectedThreadAtDispatch;
          const params = { cursor: null, limit: 100 };
          if (targetThreadId) params.threadId = targetThreadId;
          const result = await request("mcpServerStatus/list", params);
          sendJson(ws, { type: "mcpResult", threadId: targetThreadId, result, verbose: Boolean(command.verbose), reloaded: false });
          break;
        }

        case "reloadMcp": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch, { required: false });
          ensureThreadWritable(targetThreadId);
          await request("config/mcpServer/reload", {}, { threadId: targetThreadId });
          const params = { cursor: null, limit: 100 };
          if (targetThreadId) params.threadId = targetThreadId;
          const result = await request("mcpServerStatus/list", params);
          sendJson(ws, { type: "mcpResult", threadId: targetThreadId, result, verbose: Boolean(command.verbose), reloaded: true });
          break;
        }

        case "listSkills": {
          const cwd = String(command.cwd || DEFAULT_CWD);
          const result = await request("skills/list", { cwds: [cwd], forceReload: Boolean(command.forceReload) });
          sendJson(ws, { type: "skillsResult", result });
          break;
        }

        case "listHooks": {
          const cwd = String(command.cwd || DEFAULT_CWD);
          const result = await request("hooks/list", { cwds: [cwd] });
          sendJson(ws, { type: "hooksResult", result });
          break;
        }

        case "listApps": {
          const targetThreadId = command.threadId
            ? captureThreadTarget(command, selectedThreadAtDispatch)
            : selectedThreadAtDispatch;
          const params = { cursor: null, limit: 100, forceRefetch: Boolean(command.forceRefetch) };
          if (targetThreadId) params.threadId = targetThreadId;
          const result = await request("app/list", params);
          sendJson(ws, { type: "appsResult", threadId: targetThreadId, result });
          break;
        }

        case "listPlugins": {
          const result = await request("plugin/list", {});
          sendJson(ws, { type: "pluginsResult", result });
          break;
        }

        case "readUsage": {
          const [rateLimits, usage] = await Promise.all([
            safeRequest("account/rateLimits/read", {}),
            safeRequest("account/usage/read", {}),
          ]);
          sendJson(ws, {
            type: "usageResult",
            result: {
              rateLimits: rateLimits.ok ? rateLimits.result : null,
              rateLimitsError: rateLimits.ok ? null : rateLimits.error,
              usage: usage.ok ? usage.result : null,
              usageError: usage.ok ? null : usage.error,
            },
          });
          break;
        }

        case "compact": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          const result = await request("thread/compact/start", { threadId: targetThreadId });
          sendJson(ws, { type: "compactAccepted", result, threadId: targetThreadId });
          break;
        }

        case "approveGuardianDeniedAction": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch);
          ensureThreadWritable(targetThreadId);
          if (!command.event || typeof command.event !== "object") {
            throw new Error("No auto-review denial is available to retry");
          }
          const result = await request("thread/approveGuardianDeniedAction", {
            threadId: targetThreadId,
            event: command.event,
          });
          sendJson(ws, { type: "guardianDeniedActionApproved", threadId: targetThreadId, result });
          break;
        }

        case "setExperiment": {
          const targetThreadId = captureThreadTarget(command, selectedThreadAtDispatch, { required: false });
          ensureThreadWritable(targetThreadId);
          const name = String(command.name || "").trim();
          if (!name) throw new Error("Experimental feature name is required");
          const enabled = Boolean(command.enabled);
          const result = await request("experimentalFeature/enablement/set", {
            enablement: { [name]: enabled },
          }, { threadId: targetThreadId });
          const listed = await safeRequest("experimentalFeature/list", targetThreadId ? { threadId: targetThreadId } : {});
          sendJson(ws, {
            type: "experimentalUpdated",
            threadId: targetThreadId,
            name,
            enabled,
            result,
            experiments: listed.ok ? getDataList(listed.result) : null,
            listError: listed.ok ? null : listed.error,
          });
          break;
        }

        case "approval": {
          if (command.requestId === undefined) throw new Error("Approval requestId is required");
          const pendingRequest = pendingServerRequests.get(String(command.requestId));
          if (!pendingRequest) throw new Error("Approval request is stale or no longer pending");
          const approvalThreadId = captureThreadTarget(command, selectedThreadAtDispatch, {
            required: false,
            allowDifferent: true,
          }) || pendingRequest.threadId || null;
          ensureThreadWritable(approvalThreadId || pendingRequest.threadId);
          runtimeManager.respondServerRequest(
            command.requestId,
            { decision: command.decision },
            { clientId, threadId: approvalThreadId },
          );
          sendJson(ws, {
            type: "approvalAccepted",
            threadId: approvalThreadId,
            requestId: String(command.requestId),
          });
          break;
        }

        case "serverRequestResponse": {
          if (command.requestId === undefined) throw new Error("Server requestId is required");
          const pendingRequest = pendingServerRequests.get(String(command.requestId));
          if (!pendingRequest) throw new Error("Server request is stale or no longer pending");
          const responseThreadId = captureThreadTarget(command, selectedThreadAtDispatch, {
            required: false,
            allowDifferent: true,
          }) || pendingRequest.threadId || null;
          ensureThreadWritable(responseThreadId || pendingRequest.threadId);
          runtimeManager.respondServerRequest(
            command.requestId,
            command.result,
            { clientId, threadId: responseThreadId },
          );
          sendJson(ws, {
            type: "serverRequestResponseAccepted",
            threadId: responseThreadId,
            requestId: String(command.requestId),
          });
          break;
        }

        case "debugState": {
          sendJson(ws, {
            type: "debugState",
            activeThreadId,
            activeTurnId,
            accessMode: activeAccessMode,
            snapshotAt,
            snapshotReason,
            pendingTurnSettings,
            lastThreadResponse,
            selectedThreadId: activeThreadId,
            runtimes: runtimeManager.runtimeSnapshot(),
          });
          break;
        }

        default:
          throw new Error(`Unknown browser command: ${command.type}`);
      }
    } catch (error) {
      const isTurnBridge = ["sendMessage", "steerMessage", "steer"].includes(command?.type);
      const requestId = isTurnBridge || command?.type === "deleteThread" ? String(command.requestId || "").trim() : "";
      const isThreadScoped = THREAD_SCOPED_COMMANDS.has(command?.type);
      if (isTurnBridge) {
        sendJson(ws, {
          type: ["steerMessage", "steer"].includes(command.type) ? "steerAccepted" : "turnAccepted",
          requestId: requestId || turnBridgeRequestId(command),
          threadId: responseThreadId,
          accepted: false,
          error: compactError(error),
        });
        return;
      }
      sendJson(ws, {
        type: "bridgeError",
        message: error.message,
        details: compactError(error),
        ...(isThreadScoped ? { threadId: responseThreadId } : {}),
        ...(requestId ? { requestId } : {}),
      });
    }
  });

  ws.on("close", () => {
    fileAccessRoots.delete(fileAccessToken);
    runtimeManager.off("runtimeUpdate", runtimeListener);
    runtimeManager.removeClient(clientId);
  });
});

  fullRequestHandler = app;
  for (const pending of pendingUpgrades.splice(0)) {
    if (pending.socket.destroyed) continue;
    pending.socket.setTimeout(0);
    wss.handleUpgrade(pending.req, pending.socket, pending.head, (ws) => wss.emit("connection", ws, pending.req));
  }
}

server.on("close", () => activeRuntimeManager?.shutdown());

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    activeRuntimeManager?.shutdown();
    for (const client of activeWss?.clients || []) client.close();
    for (const pending of pendingUpgrades.splice(0)) pending.socket.destroy();
    if (server.listening) server.close();
  });
}

void (async () => {
  try {
    SERVER_CONFIG = loadStartupConfig(__dirname);
    if (!SERVER_CONFIG) {
      const { loadServerConfig } = await import("./server-config.mjs");
      SERVER_CONFIG = loadServerConfig({ rootDir: __dirname });
    }
    HOST = SERVER_CONFIG.host;
    PORT = SERVER_CONFIG.port;
    CODEX_BIN = SERVER_CONFIG.codexBin;
    DEFAULT_CWD = SERVER_CONFIG.projectCwd;

    server.listen(PORT, HOST, () => {
      console.log("Codex Math Web v4: http://" + HOST + ":" + PORT);
      console.log("Default project cwd: " + DEFAULT_CWD);
    });

    const [
      expressModule,
      wsModule,
      runtimeModule,
      fileAccessModule,
      threadDeleteModule,
      threadAccessModule,
    ] = await Promise.all([
      import("express"),
      import("ws"),
      import("./codex-runtime-manager.mjs"),
      import("./file-access.mjs"),
      import("./public/thread-delete-data.js"),
      import("./public/thread-access.js"),
    ]);
    initializeFullServer({
      expressModule,
      wsModule,
      runtimeModule,
      fileAccessModule,
      threadDeleteModule,
      threadAccessModule,
    });
  } catch (error) {
    console.error("Codex Web startup failed: " + error.message);
    startupFailed = true;
    activeWss = null;
    for (const pending of pendingUpgrades.splice(0)) pending.socket.destroy();
    if (server.listening) server.close();
    process.exitCode = 1;
  }
})();
