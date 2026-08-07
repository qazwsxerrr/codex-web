import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { loadServerConfig } from "./server-config.mjs";
import { resolveDeleteThreadId } from "./public/thread-delete-data.js";
import { resumeThreadWithFallback } from "./public/thread-access.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_CONFIG = loadServerConfig({ rootDir: __dirname });
const HOST = SERVER_CONFIG.host;
const PORT = SERVER_CONFIG.port;
const CODEX_BIN = SERVER_CONFIG.codexBin;
const DEFAULT_CWD = SERVER_CONFIG.projectCwd;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/marked", express.static(path.join(__dirname, "node_modules", "marked")));
app.use("/vendor/dompurify", express.static(path.join(__dirname, "node_modules", "dompurify")));
app.use("/vendor/katex", express.static(path.join(__dirname, "node_modules", "katex")));
app.use("/vendor/lucide", express.static(path.join(__dirname, "node_modules", "lucide")));
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/healthz", (_req, res) => res.json({ ok: true }));

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function compactError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    data: error?.data,
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

function getDataList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.models)) return result.models;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

wss.on("connection", (ws) => {
  const codex = spawn(CODEX_BIN, ["app-server", "--stdio"], {
    cwd: DEFAULT_CWD,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextRequestId = 1;
  let initialized = false;
  let activeThreadId = null;
  let activeTurnId = null;
  let activeWriterConflict = null;
  let activeFileSearchSessionId = null;
  let pendingTurnSettings = {};
  let lastThreadResponse = null;
  const pending = new Map();

  const stdoutLines = readline.createInterface({ input: codex.stdout });
  const stderrLines = readline.createInterface({ input: codex.stderr });

  function writeProtocol(message) {
    if (codex.stdin.destroyed) {
      throw new Error("Codex app-server stdin is closed");
    }
    codex.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function notify(method, params = {}) {
    writeProtocol({ method, params });
  }

  function request(method, params = {}) {
    const id = nextRequestId++;
    writeProtocol({ method, id, params });
    return new Promise((resolve, reject) => {
      pending.set(String(id), { resolve, reject, method });
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

  function rejectAllPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  stdoutLines.on("line", (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      sendJson(ws, {
        type: "bridgeError",
        message: `Invalid JSON from codex app-server: ${line}`,
      });
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(String(message.id));
      if (waiter) {
        pending.delete(String(message.id));
        if (message.error) {
          const error = new Error(message.error.message || JSON.stringify(message.error));
          error.code = message.error.code;
          error.data = message.error.data;
          waiter.reject(error);
        } else {
          waiter.resolve(message.result);
        }
        return;
      }
    }

    if (message.method === "thread/deleted" && message.params?.threadId === activeThreadId) {
      activeThreadId = null;
      activeTurnId = null;
      activeWriterConflict = null;
    }

    if (message.method === "turn/started" && message.params?.threadId === activeThreadId) {
      activeTurnId = message.params?.turn?.id || activeTurnId;
    }
    if (message.method === "turn/completed" && message.params?.threadId === activeThreadId) {
      const completedId = message.params?.turn?.id;
      if (!completedId || completedId === activeTurnId) activeTurnId = null;
    }

    sendJson(ws, { type: "codex", message });
  });

  stderrLines.on("line", (line) => {
    console.error(`[codex app-server] ${line}`);
    sendJson(ws, { type: "codexLog", line });
  });

  codex.on("error", (error) => {
    rejectAllPending(error);
    sendJson(ws, {
      type: "bridgeError",
      message:
        error.code === "ENOENT"
          ? `Cannot find '${CODEX_BIN}'. Install Codex CLI or set CODEX_BIN.`
          : error.message,
    });
  });

  codex.on("exit", (code, signal) => {
    const error = new Error(
      `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    );
    rejectAllPending(error);
    sendJson(ws, { type: "bridgeError", message: error.message });
  });

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
    const serverInfo = await request("initialize", {
      clientInfo: {
        name: "codex_math_web_v4",
        title: "Codex Math Web v4",
        version: "0.4.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    notify("initialized", {});
    initialized = true;
    const [metadata, recentThreads] = await Promise.all([
      fetchMetadata(DEFAULT_CWD),
      fetchRecentThreads(),
    ]);

    sendJson(ws, {
      type: "ready",
      defaultCwd: DEFAULT_CWD,
      serverInfo,
      ...metadata,
      threadList: recentThreads.ok ? recentThreads.result : null,
      threadListError: recentThreads.ok ? null : recentThreads.error,
    });
  }

  initialize().catch((error) => {
    sendJson(ws, { type: "bridgeError", message: error.message });
  });

  async function updateThreadSettings(command) {
    if (!activeThreadId) throw new Error("Start or resume a thread first");

    const requested = {};
    if (command.model !== undefined) requested.model = command.model || null;
    if (command.effort !== undefined) requested.effort = command.effort || null;
    if (command.serviceTier !== undefined) requested.serviceTier = command.serviceTier || null;
    if (command.cwd !== undefined) requested.cwd = command.cwd || null;
    if (command.permissions !== undefined) requested.permissions = command.permissions || null;
    if (command.personality !== undefined) requested.personality = command.personality || null;
    if (command.collaborationMode !== undefined) requested.collaborationMode = command.collaborationMode;

    try {
      const result = await request("thread/settings/update", {
        threadId: activeThreadId,
        ...requested,
      });
      pendingTurnSettings = {};
      sendJson(ws, {
        type: "settingsUpdateAccepted",
        mode: "thread",
        requested,
        result,
      });
    } catch (error) {
      pendingTurnSettings = { ...pendingTurnSettings, ...requested };
      sendJson(ws, {
        type: "settingsUpdateAccepted",
        mode: "nextTurnFallback",
        requested,
        warning: error.message,
      });
    }
  }

  ws.on("message", async (data) => {
    let command;
    try {
      command = JSON.parse(data.toString());
    } catch {
      sendJson(ws, { type: "bridgeError", message: "Invalid browser message" });
      return;
    }

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
          const metadata = await fetchMetadata(command.cwd || DEFAULT_CWD);
          sendJson(ws, { type: "metadata", ...metadata });
          break;
        }

        case "startThread": {
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

          const result = await request("thread/start", params);
          activeThreadId = result.thread.id;
          activeTurnId = null;
          activeWriterConflict = null;
          // `thread/start` does not accept collaborationMode in the current
          // protocol. Keep the selected preset for the first turn instead of
          // dropping it or sending an invalid parameter to App Server.
          pendingTurnSettings = command.collaborationMode !== undefined
            ? { collaborationMode: command.collaborationMode }
            : {};
          lastThreadResponse = result;
          sendJson(ws, { type: "threadReady", mode: "start", ...result });
          break;
        }

        case "resumeThread": {
          const threadId = String(command.threadId || "").trim();
          if (!threadId) throw new Error("threadId is required");
          const resumed = await resumeThreadWithFallback(request, threadId);
          const { result, writerConflict } = resumed;
          activeThreadId = result.thread.id;
          activeTurnId = null;
          activeWriterConflict = writerConflict || null;
          pendingTurnSettings = {};
          lastThreadResponse = result;
          sendJson(ws, {
            type: "threadReady",
            mode: "resume",
            ...result,
          });
          break;
        }

        case "forkThread": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/fork", { threadId: activeThreadId });
          activeThreadId = result.thread.id;
          activeTurnId = null;
          activeWriterConflict = null;
          pendingTurnSettings = {};
          lastThreadResponse = result;
          sendJson(ws, { type: "threadReady", mode: "fork", ...result });
          break;
        }

        case "updateSettings": {
          await updateThreadSettings(command);
          break;
        }

        case "sendMessage": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const requestId = turnBridgeRequestId(command);
          const requestedThreadId = String(command.threadId || "").trim();
          if (requestedThreadId && requestedThreadId !== activeThreadId) {
            throw turnBridgeError("Thread is stale or no longer active", "STALE_THREAD", {
              expectedThreadId: activeThreadId,
              receivedThreadId: requestedThreadId,
            });
          }
          if (activeWriterConflict) throw activeWriterConflict;
          const input = browserUserInput(command);

          const params = {
            threadId: activeThreadId,
            clientUserMessageId: String(command.clientUserMessageId || "").trim() || randomUUID(),
            input,
          };

          const requested = { ...pendingTurnSettings };
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
          activeTurnId = result.turn?.id || activeTurnId;
          pendingTurnSettings = {};
          sendJson(ws, { type: "turnAccepted", requestId, accepted: true, ...result });
          break;
        }

        case "steerMessage":
        case "steer": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const requestId = turnBridgeRequestId(command);
          const requestedThreadId = String(command.threadId || "").trim();
          const expectedTurnId = String(command.expectedTurnId || "").trim();
          if (!requestedThreadId || requestedThreadId !== activeThreadId) {
            throw turnBridgeError("Thread is stale or no longer active", "STALE_THREAD", {
              expectedThreadId: activeThreadId,
              receivedThreadId: requestedThreadId || null,
            });
          }
          if (!expectedTurnId || !activeTurnId || expectedTurnId !== activeTurnId) {
            throw turnBridgeError("The active turn changed before steering was accepted", "STALE_TURN", {
              expectedTurnId: activeTurnId,
              receivedTurnId: expectedTurnId || null,
            });
          }
          const input = browserUserInput(command);
          const params = {
            threadId: activeThreadId,
            expectedTurnId,
            clientUserMessageId: String(command.clientUserMessageId || "").trim() || randomUUID(),
            input,
          };
          const result = await request("turn/steer", params);
          sendJson(ws, { type: "steerAccepted", requestId, accepted: true, ...result });
          break;
        }

        case "interrupt": {
          const turnId = String(command.turnId || activeTurnId || "").trim();
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          if (!turnId) throw new Error("No active turn to interrupt");
          await request("turn/interrupt", { threadId: activeThreadId, turnId });
          break;
        }

        case "renameThread": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const name = String(command.name || "").trim();
          if (!name) throw new Error("Thread name is required");
          const result = await request("thread/name/set", { threadId: activeThreadId, name });
          sendJson(ws, { type: "threadRenamed", name, result });
          break;
        }

        case "archiveThread": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const threadId = activeThreadId;
          const result = await request("thread/archive", { threadId });
          activeThreadId = null;
          activeTurnId = null;
          activeWriterConflict = null;
          sendJson(ws, { type: "threadArchived", threadId, result });
          break;
        }

        case "deleteThread": {
          const threadId = resolveDeleteThreadId(command.threadId);
          if (!threadId) throw new Error("threadId is required");
          const requestId = String(command.requestId || "").trim() || null;
          const result = await request("thread/delete", { threadId });
          if (threadId === activeThreadId) {
            activeThreadId = null;
            activeTurnId = null;
            activeWriterConflict = null;
          }
          sendJson(ws, { type: "threadDeleted", threadId, requestId, result });
          break;
        }

        case "reviewThread": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const instructions = String(command.instructions || "").trim();
          const target = instructions
            ? { type: "custom", instructions }
            : { type: "uncommittedChanges" };
          const result = await request("review/start", {
            threadId: activeThreadId,
            delivery: "inline",
            target,
          });
          activeTurnId = result.turn?.id || activeTurnId;
          sendJson(ws, { type: "reviewAccepted", ...result });
          break;
        }

        case "getGoal": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/goal/get", { threadId: activeThreadId });
          sendJson(ws, { type: "goalResult", action: "get", result });
          break;
        }

        case "setGoal": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const objective = String(command.objective || "").trim();
          if (!objective) throw new Error("Goal objective is required");
          const result = await request("thread/goal/set", {
            threadId: activeThreadId,
            objective,
            status: "active",
          });
          sendJson(ws, { type: "goalResult", action: "set", result });
          break;
        }

        case "clearGoal": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/goal/clear", { threadId: activeThreadId });
          sendJson(ws, { type: "goalResult", action: "clear", result });
          break;
        }

        case "setMemoryMode": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const mode = command.mode === "disabled" ? "disabled" : "enabled";
          const result = await request("thread/memoryMode/set", { threadId: activeThreadId, mode });
          sendJson(ws, { type: "memoryModeUpdated", mode, result });
          break;
        }

        case "listBackgroundTerminals": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/backgroundTerminals/list", { threadId: activeThreadId });
          sendJson(ws, { type: "backgroundTerminalsResult", result });
          break;
        }

        case "cleanBackgroundTerminals": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/backgroundTerminals/clean", { threadId: activeThreadId });
          sendJson(ws, { type: "backgroundTerminalsCleaned", result });
          break;
        }

        case "logout": {
          const result = await request("account/logout", {});
          sendJson(ws, { type: "loggedOut", result });
          break;
        }

        case "listMcp": {
          const params = { cursor: null, limit: 100 };
          if (activeThreadId) params.threadId = activeThreadId;
          const result = await request("mcpServerStatus/list", params);
          sendJson(ws, { type: "mcpResult", result, verbose: Boolean(command.verbose), reloaded: false });
          break;
        }

        case "reloadMcp": {
          await request("config/mcpServer/reload", {});
          const params = { cursor: null, limit: 100 };
          if (activeThreadId) params.threadId = activeThreadId;
          const result = await request("mcpServerStatus/list", params);
          sendJson(ws, { type: "mcpResult", result, verbose: Boolean(command.verbose), reloaded: true });
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
          const params = { cursor: null, limit: 100, forceRefetch: Boolean(command.forceRefetch) };
          if (activeThreadId) params.threadId = activeThreadId;
          const result = await request("app/list", params);
          sendJson(ws, { type: "appsResult", result });
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
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          const result = await request("thread/compact/start", { threadId: activeThreadId });
          sendJson(ws, { type: "compactAccepted", result });
          break;
        }

        case "approveGuardianDeniedAction": {
          if (!activeThreadId) throw new Error("Start or resume a thread first");
          if (!command.event || typeof command.event !== "object") {
            throw new Error("No auto-review denial is available to retry");
          }
          const result = await request("thread/approveGuardianDeniedAction", {
            threadId: activeThreadId,
            event: command.event,
          });
          sendJson(ws, { type: "guardianDeniedActionApproved", result });
          break;
        }

        case "setExperiment": {
          const name = String(command.name || "").trim();
          if (!name) throw new Error("Experimental feature name is required");
          const enabled = Boolean(command.enabled);
          const result = await request("experimentalFeature/enablement/set", {
            enablement: { [name]: enabled },
          });
          const listed = await safeRequest(
            "experimentalFeature/list",
            activeThreadId ? { threadId: activeThreadId } : {},
          );
          sendJson(ws, {
            type: "experimentalUpdated",
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
          writeProtocol({
            id: command.requestId,
            result: { decision: command.decision },
          });
          break;
        }

        case "serverRequestResponse": {
          if (command.requestId === undefined) throw new Error("Server requestId is required");
          writeProtocol({
            id: command.requestId,
            result: command.result,
          });
          break;
        }

        case "debugState": {
          sendJson(ws, {
            type: "debugState",
            activeThreadId,
            activeTurnId,
            pendingTurnSettings,
            lastThreadResponse,
          });
          break;
        }

        default:
          throw new Error(`Unknown browser command: ${command.type}`);
      }
    } catch (error) {
      const isTurnBridge = ["sendMessage", "steerMessage", "steer"].includes(command?.type);
      const requestId = isTurnBridge || command?.type === "deleteThread" ? String(command.requestId || "").trim() : "";
      if (isTurnBridge) {
        sendJson(ws, {
          type: ["steerMessage", "steer"].includes(command.type) ? "steerAccepted" : "turnAccepted",
          requestId: requestId || turnBridgeRequestId(command),
          accepted: false,
          error: compactError(error),
        });
        return;
      }
      sendJson(ws, {
        type: "bridgeError",
        message: error.message,
        details: compactError(error),
        ...(requestId ? { requestId } : {}),
      });
    }
  });

  ws.on("close", () => {
    stdoutLines.close();
    stderrLines.close();
    rejectAllPending(new Error("Browser connection closed"));
    codex.kill("SIGTERM");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Math Web v4: http://${HOST}:${PORT}`);
  console.log(`Default project cwd: ${DEFAULT_CWD}`);
});
