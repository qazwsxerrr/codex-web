import { EventEmitter } from "node:events";
import { spawn as defaultSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const DEFAULT_CLIENT_INFO = {
  name: "codex_math_web_v4",
  title: "Codex Math Web v4",
  version: "0.4.0",
};

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function runtimeKey(threadId) {
  const value = String(threadId || "").trim();
  return value || null;
}

function requestThreadId(message, fallback = null) {
  const params = message?.params || {};
  return runtimeKey(params.threadId || params.thread?.id || fallback);
}

function errorFromRpc(message) {
  const error = new Error(message?.error?.message || JSON.stringify(message?.error));
  error.code = message?.error?.code;
  error.data = message?.error?.data;
  return error;
}

function runtimeDefaults(threadId) {
  return {
    threadId,
    activeTurnId: null,
    status: "idle",
    running: false,
    accessMode: null,
    snapshotAt: null,
    snapshotReason: null,
    writerConflict: null,
    pendingTurnSettings: {},
    latestThreadResponse: null,
    latestEvent: null,
    lastActivityAt: null,
    unread: false,
    error: null,
    pendingServerRequests: new Map(),
  };
}

export function isThreadRuntimeRunning(runtime) {
  return Boolean(runtime?.running || runtime?.activeTurnId);
}

/**
 * Own the App Server for the lifetime of the Node service, independently of
 * browser subscriptions. A client may disappear without interrupting a Turn.
 */
export class CodexRuntimeManager extends EventEmitter {
  constructor({
    codexBin = "codex",
    cwd = process.cwd(),
    env = process.env,
    spawnImpl = defaultSpawn,
    now = () => new Date().toISOString(),
    clientInfo = DEFAULT_CLIENT_INFO,
    capabilities = { experimentalApi: true },
  } = {}) {
    super();
    this.codexBin = codexBin;
    this.cwd = cwd;
    this.env = env;
    this.spawnImpl = spawnImpl;
    this.now = now;
    this.clientInfo = { ...clientInfo };
    this.capabilities = { ...capabilities };
    this.process = null;
    this.stdoutLines = null;
    this.stderrLines = null;
    this.nextRequestId = 1;
    this.nextClientId = 1;
    this.pending = new Map();
    this.pendingServerRequests = new Map();
    this.runtimes = new Map();
    this.clients = new Map();
    this.initialized = false;
    this.initializing = null;
    this.serverInfo = null;
    this.closed = false;
  }

  start() {
    if (this.closed) throw new Error("Codex runtime manager is shut down");
    if (this.process) return this.process;

    const child = this.spawnImpl(this.codexBin, ["app-server", "--stdio"], {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.stdoutLines = readline.createInterface({ input: child.stdout });
    this.stderrLines = readline.createInterface({ input: child.stderr });
    this.stdoutLines.on("line", (line) => this.#handleLine(line));
    this.stderrLines.on("line", (line) => {
      if (!line) return;
      console.error(`[codex app-server] ${line}`);
      this.emit("log", line);
      this.#broadcast({ type: "codexLog", line });
    });
    child.on("error", (error) => this.#handleProcessError(error));
    child.on("exit", (code, signal) => this.#handleExit(code, signal));
    return child;
  }

  async initialize() {
    if (this.closed) throw new Error("Codex runtime manager is shut down");
    if (this.initialized && this.serverInfo) return this.serverInfo;
    if (this.initializing) return this.initializing;

    this.start();
    this.initializing = this.request("initialize", {
      clientInfo: this.clientInfo,
      capabilities: this.capabilities,
    }, { internal: true }).then((serverInfo) => {
      this.notify("initialized", {});
      this.initialized = true;
      this.serverInfo = serverInfo;
      return serverInfo;
    }).finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  addClient(send) {
    const id = `client-${this.nextClientId++}`;
    this.clients.set(id, typeof send === "function" ? send : () => {});
    return id;
  }

  removeClient(clientId) {
    this.clients.delete(clientId);
  }

  clientCount() {
    return this.clients.size;
  }

  sendRuntimeSnapshot(clientId) {
    const send = this.clients.get(clientId);
    if (!send) return false;
    send({
      type: "runtimeSnapshot",
      runtimes: this.runtimeSnapshot(),
      serverInfo: this.serverInfo,
      initialized: this.initialized,
    });
    return true;
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  request(method, params = {}, { clientId = null, scope = null, threadId = null, internal = false } = {}) {
    if (this.closed) return Promise.reject(new Error("Codex runtime manager is shut down"));
    this.start();
    const id = this.nextRequestId++;
    const request = {
      id: String(id),
      method,
      params: clone(params) || {},
      clientId,
      scope,
      threadId: runtimeKey(threadId || params.threadId),
      internal,
      createdAt: this.now(),
    };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(request.id, { ...request, resolve, reject });
    });
    try {
      this.#write({ method, id, params });
    } catch (error) {
      this.pending.delete(request.id);
      return Promise.reject(error);
    }
    return promise;
  }

  async safeRequest(method, params = {}, options = {}) {
    try {
      return { ok: true, result: await this.request(method, params, options) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  getRuntime(threadId) {
    const key = runtimeKey(threadId);
    return key ? this.runtimes.get(key) || null : null;
  }

  forgetThread(threadId) {
    const key = runtimeKey(threadId);
    if (!key) return false;
    const existed = this.runtimes.delete(key);
    if (existed) this.#broadcast({ type: "runtimeUpdate", threadId: key, deleted: true });
    for (const [requestId, request] of this.pendingServerRequests) {
      if (request.threadId === key) this.pendingServerRequests.delete(requestId);
    }
    return existed;
  }

  ensureRuntime(threadId) {
    const key = runtimeKey(threadId);
    if (!key) return null;
    let runtime = this.runtimes.get(key);
    if (!runtime) {
      runtime = runtimeDefaults(key);
      this.runtimes.set(key, runtime);
    }
    return runtime;
  }

  updateRuntime(threadId, patch = {}, { broadcast = true } = {}) {
    const runtime = this.ensureRuntime(threadId);
    if (!runtime) return null;
    Object.assign(runtime, patch);
    if (broadcast) this.#emitRuntimeUpdate(runtime);
    return runtime;
  }

  registerThread(result, metadata = {}) {
    const threadId = runtimeKey(result?.thread?.id || result?.threadId || metadata.threadId);
    if (!threadId) return null;
    const current = this.ensureRuntime(threadId);
    const accessMode = metadata.accessMode || current.accessMode || "live";
    Object.assign(current, {
      latestThreadResponse: clone(result),
      accessMode,
      snapshotAt: accessMode === "snapshot" ? metadata.snapshotAt || current.snapshotAt || null : null,
      snapshotReason: accessMode === "snapshot" ? metadata.snapshotReason || current.snapshotReason || null : null,
      writerConflict: metadata.writerConflict || current.writerConflict || null,
      error: metadata.error === undefined ? null : clone(metadata.error),
      activeTurnId: metadata.activeTurnId === undefined ? current.activeTurnId : metadata.activeTurnId,
      pendingTurnSettings: metadata.pendingTurnSettings === undefined
        ? current.pendingTurnSettings
        : { ...metadata.pendingTurnSettings },
    });
    this.#emitRuntimeUpdate(current);
    return current;
  }

  setPendingTurnSettings(threadId, settings = {}) {
    const runtime = this.ensureRuntime(threadId);
    if (!runtime) return null;
    runtime.pendingTurnSettings = { ...settings };
    this.#emitRuntimeUpdate(runtime);
    return runtime;
  }

  getPendingServerRequest(requestId) {
    return this.pendingServerRequests.get(String(requestId)) || null;
  }

  dropServerRequest(requestId) {
    const key = String(requestId);
    const request = this.pendingServerRequests.get(key);
    if (!request) return false;
    this.pendingServerRequests.delete(key);
    this.getRuntime(request.threadId)?.pendingServerRequests.delete(key);
    this.#emitRuntimeUpdate(this.getRuntime(request.threadId));
    return true;
  }

  respondServerRequest(requestId, result, { clientId = null, threadId = null } = {}) {
    const key = String(requestId);
    const request = this.pendingServerRequests.get(key);
    if (!request) {
      const error = new Error("Server request is stale or no longer pending");
      error.code = "STALE_SERVER_REQUEST";
      throw error;
    }
    const targetThreadId = runtimeKey(threadId);
    if (targetThreadId && request.threadId && targetThreadId !== request.threadId) {
      const error = new Error("Server request belongs to another thread");
      error.code = "THREAD_REQUEST_MISMATCH";
      error.data = { expectedThreadId: request.threadId, receivedThreadId: targetThreadId };
      throw error;
    }
    this.pendingServerRequests.delete(key);
    const runtime = this.getRuntime(request.threadId);
    runtime?.pendingServerRequests.delete(key);
    this.#emitRuntimeUpdate(runtime);
    try {
      this.#write({ id: requestId, result });
    } catch (error) {
      this.pendingServerRequests.set(key, request);
      runtime?.pendingServerRequests.set(key, request);
      this.#emitRuntimeUpdate(runtime);
      throw error;
    }
    this.emit("serverRequestResolved", { ...request, requestId: key, clientId });
    return request;
  }

  expireServerRequests(error = new Error("Codex app-server stopped")) {
    const requests = [...this.pendingServerRequests.values()];
    this.pendingServerRequests.clear();
    for (const runtime of this.runtimes.values()) runtime.pendingServerRequests.clear();
    if (requests.length) {
      this.#broadcast({
        type: "serverRequestsExpired",
        requestIds: requests.map((request) => request.id),
        message: error.message,
      });
      for (const runtime of this.runtimes.values()) this.#emitRuntimeUpdate(runtime);
    }
    return requests;
  }

  runtimeSnapshot() {
    return [...this.runtimes.values()].map((runtime) => this.#serializeRuntime(runtime));
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("Codex runtime manager shut down");
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.expireServerRequests(error);
    this.#closeReaders();
    if (this.process && !this.process.killed) this.process.kill("SIGTERM");
    this.process = null;
    this.initialized = false;
    this.serverInfo = null;
  }

  #write(message) {
    if (!this.process?.stdin || this.process.stdin.destroyed) {
      throw new Error("Codex app-server stdin is closed");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    if (!String(line || "").trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const error = new Error(`Invalid JSON from codex app-server: ${line}`);
      this.emit("errorMessage", error);
      this.#broadcast({ type: "bridgeError", message: error.message });
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(String(message.id));
      if (!waiter) return;
      this.pending.delete(String(message.id));
      if (message.error) waiter.reject(errorFromRpc(message));
      else waiter.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method !== undefined) {
      const threadId = requestThreadId(message, null);
      const request = {
        id: String(message.id),
        method: message.method,
        params: clone(message.params) || {},
        threadId,
        turnId: message.params?.turnId || null,
        createdAt: this.now(),
      };
      this.pendingServerRequests.set(request.id, request);
      const runtime = threadId ? this.ensureRuntime(threadId) : null;
      runtime?.pendingServerRequests.set(request.id, request);
      this.#emitRuntimeUpdate(runtime);
    }

    this.#applyNotification(message);
    this.emit("message", message);
    this.#broadcast({ type: "codex", message });
  }

  #applyNotification(message) {
    const params = message?.params || {};
    const method = message?.method;
    const threadId = requestThreadId(message, null);
    if (method === "serverRequest/resolved" && params.requestId !== undefined) {
      const key = String(params.requestId);
      const request = this.pendingServerRequests.get(key);
      this.pendingServerRequests.delete(key);
      const runtime = this.getRuntime(request?.threadId || threadId);
      runtime?.pendingServerRequests.delete(key);
      this.#emitRuntimeUpdate(runtime);
      return;
    }
    if (!threadId) return;
    const runtime = this.ensureRuntime(threadId);
    const base = {
      latestEvent: { method, params: clone(params), receivedAt: this.now() },
      lastActivityAt: this.now(),
      unread: true,
    };
    if (method === "turn/started") {
      base.activeTurnId = params.turn?.id || params.turnId || runtime.activeTurnId;
      base.running = true;
      base.status = "active";
      base.error = null;
    } else if (["turn/completed", "turn/interrupted", "turn/failed", "turn/cancelled"].includes(method)) {
      const eventTurnId = params.turn?.id || params.turnId || null;
      if (!eventTurnId || !runtime.activeTurnId || eventTurnId === runtime.activeTurnId) {
        base.activeTurnId = null;
        base.running = false;
      }
      base.status = method === "turn/completed" ? "completed" : "error";
    } else if (method === "thread/deleted") {
      this.runtimes.delete(threadId);
      this.#broadcast({ type: "runtimeUpdate", threadId, deleted: true });
      return;
    }
    Object.assign(runtime, base);
    this.#emitRuntimeUpdate(runtime);
  }

  #serializeRuntime(runtime) {
    return {
      threadId: runtime.threadId,
      activeTurnId: runtime.activeTurnId,
      status: runtime.status,
      running: Boolean(runtime.running),
      accessMode: runtime.accessMode,
      snapshotAt: runtime.snapshotAt,
      snapshotReason: runtime.snapshotReason,
      writerConflict: clone(runtime.writerConflict),
      pendingTurnSettings: clone(runtime.pendingTurnSettings) || {},
      latestThreadResponse: clone(runtime.latestThreadResponse),
      latestThread: clone(runtime.latestThreadResponse?.thread || null),
      latestSnapshot: clone(runtime.latestThreadResponse),
      latestEvent: clone(runtime.latestEvent),
      lastActivityAt: runtime.lastActivityAt,
      unread: Boolean(runtime.unread),
      error: clone(runtime.error),
      pendingServerRequests: [...runtime.pendingServerRequests.values()].map((request) => ({
        id: request.id,
        requestId: request.id,
        method: request.method,
        params: clone(request.params) || {},
        threadId: request.threadId,
        turnId: request.turnId,
        createdAt: request.createdAt,
      })),
    };
  }

  #emitRuntimeUpdate(runtime) {
    if (!runtime) return;
    const payload = {
      type: "runtimeUpdate",
      threadId: runtime.threadId,
      runtime: this.#serializeRuntime(runtime),
    };
    this.emit("runtimeUpdate", payload);
    this.#broadcast(payload);
  }

  #broadcast(payload) {
    for (const send of this.clients.values()) {
      try {
        send(payload);
      } catch (error) {
        this.emit("clientError", error);
      }
    }
  }

  #handleProcessError(error) {
    this.#rejectPending(error);
    this.expireServerRequests(error);
    for (const runtime of this.runtimes.values()) {
      runtime.running = false;
      runtime.status = "error";
      runtime.error = { message: error.message, code: error.code };
      this.#emitRuntimeUpdate(runtime);
    }
    const message = error?.code === "ENOENT"
      ? `Cannot find '${this.codexBin}'. Install Codex CLI or set CODEX_BIN.`
      : error.message;
    this.emit("processError", error);
    this.#broadcast({ type: "bridgeError", message });
  }

  #handleExit(code, signal) {
    const error = new Error(`codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    this.#rejectPending(error);
    this.expireServerRequests(error);
    for (const runtime of this.runtimes.values()) {
      runtime.running = false;
      runtime.status = "error";
      runtime.error = { message: error.message, code: error.code };
      this.#emitRuntimeUpdate(runtime);
    }
    this.#closeReaders();
    this.process = null;
    this.initialized = false;
    this.serverInfo = null;
    this.initializing = null;
    this.emit("processExit", { code, signal, error });
    this.#broadcast({ type: "bridgeError", message: error.message });
  }

  #rejectPending(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  #closeReaders() {
    this.stdoutLines?.close();
    this.stderrLines?.close();
    this.stdoutLines = null;
    this.stderrLines = null;
  }
}

export function createRuntimeManager(options) {
  return new CodexRuntimeManager(options);
}

export function makeRuntimeClientId() {
  return randomUUID();
}
