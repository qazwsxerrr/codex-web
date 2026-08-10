const DEFAULT_RECONNECT_BASE_DELAY = 250;
const DEFAULT_RECONNECT_MAX_DELAY = 8_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;

export const BRIDGE_STATES = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  RECONNECTING: "reconnecting",
  CLOSED: "closed",
});

const READY_STATE = Object.freeze({
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
});

function finiteNumber(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function normalizeError(value) {
  if (value instanceof Error) return value;
  if (value?.error instanceof Error) return value.error;
  const message = value?.message || String(value || "WebSocket error");
  return new Error(message);
}

function normalizeEvent(type, event) {
  if (event && typeof event === "object") {
    if (event.type === type) return event;
    return { type, ...event };
  }
  return { type, data: event };
}

function defaultWebSocketUrl(locationLike = globalThis.location) {
  const protocol = locationLike?.protocol === "https:" ? "wss:" : "ws:";
  const host = locationLike?.host || "127.0.0.1";
  return `${protocol}//${host}/ws`;
}

function listenerSet(map, type) {
  let listeners = map.get(type);
  if (!listeners) {
    listeners = new Set();
    map.set(type, listeners);
  }
  return listeners;
}

/**
 * A small WebSocket transport that can be started before the application
 * module is loaded. It intentionally buffers only inbound messages for which
 * no subscriber exists; commands are never replayed after reconnect.
 */
export class BridgeClient {
  constructor(options = {}) {
    const factory = options.webSocketFactory
      || options.socketFactory
      || options.createWebSocket
      || null;
    this._factory = typeof factory === "function" ? factory : null;
    this._WebSocket = options.WebSocket
      || options.WebSocketImpl
      || globalThis.WebSocket
      || null;
    this._location = options.location || globalThis.location;
    this._url = options.url || options.wsUrl || null;
    this._protocols = options.protocols;
    this._setTimeout = options.setTimeout || globalThis.setTimeout;
    this._clearTimeout = options.clearTimeout || globalThis.clearTimeout;
    this._reconnectDelay = options.reconnectDelay;
    this._reconnectBaseDelay = finiteNumber(options.reconnectBaseDelay, DEFAULT_RECONNECT_BASE_DELAY);
    this._reconnectMaxDelay = finiteNumber(options.reconnectMaxDelay, DEFAULT_RECONNECT_MAX_DELAY);
    this._maxReconnectAttempts = Math.floor(finiteNumber(
      options.maxReconnectAttempts,
      DEFAULT_MAX_RECONNECT_ATTEMPTS,
    ));
    this._maxBufferedMessages = options.maxBufferedMessages === undefined
      ? Infinity
      : Math.floor(finiteNumber(options.maxBufferedMessages, Infinity));
    this._onListenerError = typeof options.onListenerError === "function"
      ? options.onListenerError
      : null;

    this._state = BRIDGE_STATES.IDLE;
    this._started = false;
    this._closed = false;
    this._reconnectExhausted = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._generation = 0;
    this._socket = null;
    this._socketHandlers = null;
    this._buffer = [];
    this._lastError = null;
    this._messageListeners = new Set();
    this._eventListeners = new Map();
    this._propertyListeners = new Map();
  }

  get state() {
    return this._state;
  }

  get status() {
    return this._state;
  }

  get connectionState() {
    return this._state;
  }

  get stateSnapshot() {
    return this.getState();
  }

  get readyState() {
    if (this._socket && Number.isInteger(this._socket.readyState)) return this._socket.readyState;
    if (this._state === BRIDGE_STATES.CONNECTING || this._state === BRIDGE_STATES.RECONNECTING) {
      return READY_STATE.CONNECTING;
    }
    return this._state === BRIDGE_STATES.OPEN ? READY_STATE.OPEN : READY_STATE.CLOSED;
  }

  get socket() {
    return this._socket;
  }

  get reconnectAttempt() {
    return this._reconnectAttempt;
  }

  get reconnectTimer() {
    return this._reconnectTimer;
  }

  get reconnectExhausted() {
    return this._reconnectExhausted;
  }

  get bufferedMessageCount() {
    return this._buffer.length;
  }

  get lastError() {
    return this._lastError;
  }

  getState() {
    return {
      state: this._state,
      status: this._state,
      connectionState: this._state,
      readyState: this.readyState,
      reconnectAttempt: this._reconnectAttempt,
      reconnectExhausted: this._reconnectExhausted,
      bufferedMessageCount: this._buffer.length,
      lastError: this._lastError,
    };
  }

  start() {
    if (this._started || this._closed) return this;
    this._started = true;
    this._connect();
    return this;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Bridge subscriber must be a function");
    this._messageListeners.add(listener);
    this._flushBufferedMessages();
    return () => this.unsubscribe(listener);
  }

  unsubscribe(listener) {
    this._messageListeners.delete(listener);
    return this;
  }

  subscribeState(listener) {
    if (typeof listener !== "function") throw new TypeError("Bridge state subscriber must be a function");
    const listeners = listenerSet(this._eventListeners, "statechange");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  addEventListener(type, listener) {
    if (typeof listener !== "function") return;
    if (type === "message") {
      this.subscribe(listener);
      return;
    }
    listenerSet(this._eventListeners, type).add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "message") {
      this.unsubscribe(listener);
      return;
    }
    this._eventListeners.get(type)?.delete(listener);
  }

  set onmessage(listener) {
    this._setPropertyListener("message", listener);
  }

  get onmessage() {
    return this._propertyListeners.get("message") || null;
  }

  set onopen(listener) {
    this._setPropertyListener("open", listener);
  }

  get onopen() {
    return this._propertyListeners.get("open") || null;
  }

  set onclose(listener) {
    this._setPropertyListener("close", listener);
  }

  get onclose() {
    return this._propertyListeners.get("close") || null;
  }

  set onerror(listener) {
    this._setPropertyListener("error", listener);
  }

  get onerror() {
    return this._propertyListeners.get("error") || null;
  }

  set onstatechange(listener) {
    this._setPropertyListener("statechange", listener);
  }

  get onstatechange() {
    return this._propertyListeners.get("statechange") || null;
  }

  send(payload) {
    if (!this._socket || this.readyState !== READY_STATE.OPEN) return false;
    let data = payload;
    if (typeof payload !== "string") {
      try {
        data = JSON.stringify(payload);
      } catch (error) {
        this._lastError = normalizeError(error);
        this._emit("error", this._lastError);
        return false;
      }
      if (data === undefined) return false;
    }
    try {
      this._socket.send(data);
      return true;
    } catch (error) {
      this._lastError = normalizeError(error);
      this._emit("error", this._lastError);
      return false;
    }
  }

  close(code, reason = "") {
    if (this._closed) return this;
    this._closed = true;
    this._started = false;
    this._reconnectExhausted = false;
    this._clearReconnectTimer();
    const socket = this._socket;
    const handlers = this._socketHandlers;
    this._socket = null;
    this._socketHandlers = null;
    this._generation += 1;
    if (socket) this._detachSocket(socket, handlers);
    this._setState(BRIDGE_STATES.CLOSED);
    if (socket) {
      try {
        socket.close(code, reason);
      } catch (error) {
        this._lastError = normalizeError(error);
      }
      this._emit("close", {
        type: "close",
        code: Number.isInteger(code) ? code : 1000,
        reason: String(reason || ""),
        wasClean: true,
      });
    }
    return this;
  }

  _setState(nextState) {
    if (this._state === nextState) return;
    const previousState = this._state;
    this._state = nextState;
    this._emit("statechange", {
      type: "statechange",
      state: nextState,
      previousState,
      readyState: this.readyState,
      reconnectAttempt: this._reconnectAttempt,
    });
  }

  _setPropertyListener(type, listener) {
    const previous = this._propertyListeners.get(type);
    if (previous) this._eventListeners.get(type)?.delete(previous);
    if (typeof listener === "function") {
      this._propertyListeners.set(type, listener);
      listenerSet(this._eventListeners, type).add(listener);
    } else {
      this._propertyListeners.delete(type);
    }
  }

  _resolveUrl() {
    const value = typeof this._url === "function" ? this._url() : this._url;
    return value || defaultWebSocketUrl(this._location);
  }

  _createSocket() {
    const url = this._resolveUrl();
    if (this._factory) return this._factory(url, this._protocols);
    if (typeof this._WebSocket !== "function") {
      throw new Error("WebSocket is unavailable");
    }
    return this._protocols === undefined
      ? new this._WebSocket(url)
      : new this._WebSocket(url, this._protocols);
  }

  _connect() {
    if (!this._started || this._closed || this._socket || this._reconnectExhausted) return;
    this._setState(BRIDGE_STATES.CONNECTING);
    const generation = ++this._generation;
    let socket;
    try {
      socket = this._createSocket();
      if (!socket) throw new Error("WebSocket factory returned no socket");
    } catch (error) {
      this._lastError = normalizeError(error);
      this._emit("error", this._lastError);
      this._scheduleReconnect();
      return;
    }
    this._socket = socket;
    this._socketHandlers = this._attachSocket(socket, generation);
  }

  _attachSocket(socket, generation) {
    const handlers = {
      open: (event) => this._handleOpen(socket, generation, event),
      message: (event) => this._handleMessage(socket, generation, event),
      error: (event) => this._handleError(socket, generation, event),
      close: (event) => this._handleClose(socket, generation, event),
    };
    const types = Object.keys(handlers);
    if (typeof socket.addEventListener === "function") {
      for (const type of types) socket.addEventListener(type, handlers[type]);
      return { mode: "eventTarget", handlers };
    }
    if (typeof socket.on === "function") {
      for (const type of types) socket.on(type, handlers[type]);
      return { mode: "node", handlers };
    }
    for (const type of types) socket[`on${type}`] = handlers[type];
    return { mode: "property", handlers };
  }

  _detachSocket(socket, record = this._socketHandlers) {
    if (!socket || !record?.handlers) return;
    const { mode, handlers } = record;
    for (const type of Object.keys(handlers)) {
      if (mode === "eventTarget" && typeof socket.removeEventListener === "function") {
        socket.removeEventListener(type, handlers[type]);
      } else if (mode === "node" && typeof socket.off === "function") {
        socket.off(type, handlers[type]);
      } else if (mode === "property" && socket[`on${type}`] === handlers[type]) {
        socket[`on${type}`] = null;
      }
    }
  }

  _isCurrent(socket, generation) {
    return this._socket === socket && this._generation === generation;
  }

  _handleOpen(socket, generation, event) {
    if (!this._isCurrent(socket, generation)) return;
    this._lastError = null;
    this._reconnectAttempt = 0;
    this._reconnectExhausted = false;
    this._setState(BRIDGE_STATES.OPEN);
    this._emit("open", normalizeEvent("open", event));
  }

  _handleMessage(socket, generation, event) {
    if (!this._isCurrent(socket, generation)) return;
    const message = normalizeEvent("message", event);
    if (this._messageListeners.size === 0) {
      if (this._buffer.length >= this._maxBufferedMessages) this._buffer.shift();
      this._buffer.push(message);
      return;
    }
    this._dispatchMessage(message);
  }

  _handleError(socket, generation, event) {
    if (!this._isCurrent(socket, generation)) return;
    this._lastError = normalizeError(event);
    this._emit("error", normalizeEvent("error", event));
    // Browsers follow an error with close. Reconnect from close so that one
    // transport failure cannot create two sockets or two retry timers.
  }

  _handleClose(socket, generation, event) {
    if (!this._isCurrent(socket, generation)) return;
    this._detachSocket(socket, this._socketHandlers);
    this._socket = null;
    this._socketHandlers = null;
    this._emit("close", normalizeEvent("close", event));
    if (this._closed || !this._started) {
      this._setState(BRIDGE_STATES.CLOSED);
      return;
    }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._closed || !this._started || this._reconnectTimer) return;
    if (this._reconnectAttempt >= this._maxReconnectAttempts) {
      this._reconnectExhausted = true;
      this._setState(BRIDGE_STATES.CLOSED);
      return;
    }
    const attempt = this._reconnectAttempt;
    this._reconnectAttempt += 1;
    this._setState(BRIDGE_STATES.RECONNECTING);
    const delay = this._getReconnectDelay(attempt);
    this._reconnectTimer = this._setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _getReconnectDelay(attempt) {
    if (typeof this._reconnectDelay === "function") {
      return finiteNumber(this._reconnectDelay(attempt), 0);
    }
    if (this._reconnectDelay !== undefined) {
      return finiteNumber(this._reconnectDelay, 0);
    }
    const delay = this._reconnectBaseDelay * (2 ** attempt);
    return Math.min(this._reconnectMaxDelay, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer === null) return;
    this._clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _flushBufferedMessages() {
    while (this._buffer.length && this._messageListeners.size) {
      const message = this._buffer.shift();
      this._dispatchMessage(message);
    }
  }

  _dispatchMessage(message) {
    for (const listener of [...this._messageListeners]) {
      if (!this._messageListeners.has(listener)) continue;
      this._callListener(listener, message);
    }
  }

  _emit(type, event) {
    const listeners = this._eventListeners.get(type);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) this._callListener(listener, event);
    }
  }

  _callListener(listener, event) {
    try {
      listener(event);
    } catch (error) {
      if (this._onListenerError) {
        try {
          this._onListenerError(error, event);
        } catch {
          // Listener error hooks must not break transport delivery.
        }
      }
    }
  }
}

export function defaultBridgeUrl(locationLike = globalThis.location) {
  return defaultWebSocketUrl(locationLike);
}

export function createBridgeClient(options = {}) {
  return new BridgeClient(options);
}

export const createBridge = createBridgeClient;

const SINGLETON_KEY = "__codexBridgeClient";

export function getBridgeClient(options = {}) {
  const root = globalThis;
  const existing = root?.[SINGLETON_KEY];
  if (existing && typeof existing.start === "function" && typeof existing.subscribe === "function") {
    root.codexBridge = existing;
    root.codexWebBridge = existing;
    root.codexBridgeClient = existing;
    return existing;
  }
  const client = new BridgeClient(options);
  if (root) {
    root[SINGLETON_KEY] = client;
    root.codexBridge = client;
    root.codexWebBridge = client;
    root.codexBridgeClient = client;
  }
  return client;
}

export const bridgeClient = getBridgeClient();
export const bridge = bridgeClient;
export const getBridge = getBridgeClient;

export default bridgeClient;
