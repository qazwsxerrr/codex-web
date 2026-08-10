import { bridgeClient, getBridgeClient } from "./bridge-client.js";

const DEFAULT_APP_MODULE = "/app.js";
const FATAL_ATTRIBUTE = "data-codex-bootstrap-error";

// Keep the bridge available under a stable browser-global for app modules that
// are loaded dynamically or need to bridge an older integration boundary.
export function exposeBridge(client = bridgeClient) {
  if (typeof globalThis !== "undefined") {
    globalThis.codexBridge = client;
    globalThis.codexWebBridge = client;
  }
  return client;
}

export function renderBootstrapError(error, documentLike = globalThis.document) {
  if (!documentLike || typeof documentLike.createElement !== "function") return null;
  const message = error?.message || String(error || "Unknown startup error");
  let node = typeof documentLike.querySelector === "function"
    ? documentLike.querySelector(`[${FATAL_ATTRIBUTE}]`)
    : null;
  if (!node) {
    node = documentLike.createElement("div");
    node.setAttribute(FATAL_ATTRIBUTE, "true");
    node.setAttribute("role", "alert");
    node.setAttribute("aria-live", "assertive");
    if (node.style) {
      node.style.cssText = [
        "position:fixed",
        "inset:16px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
        "border:1px solid #d8a0a0",
        "border-radius:8px",
        "background:#fff8f8",
        "color:#7f1d1d",
        "font:600 15px/1.5 system-ui,sans-serif",
        "white-space:pre-wrap",
      ].join(";");
    }
    const target = documentLike.body || documentLike.documentElement;
    if (typeof target?.prepend === "function") target.prepend(node);
    else target?.appendChild?.(node);
  }
  node.textContent = `Codex failed to load. ${message}`;
  return node;
}

function closeAfterFailure(client) {
  try {
    client?.close?.();
  } catch {
    // The import error is the actionable startup failure.
  }
}

function notifyFatal(options, error, node) {
  if (typeof options.onFatalError !== "function") return;
  try {
    options.onFatalError(error, node);
  } catch {
    // A reporting hook must not hide the original startup failure.
  }
}

/**
 * Start the early bridge and only then load the UI application module.
 * `importApp` is injectable so startup ordering and failure behavior can be
 * tested without evaluating the DOM-heavy app module.
 */
export function bootstrap(options = {}) {
  const client = exposeBridge(options.bridge || getBridgeClient());
  const importApp = options.importApp || (() => import(options.appModule || DEFAULT_APP_MODULE));
  let startResult;
  try {
    startResult = client.start?.();
  } catch (error) {
    closeAfterFailure(client);
    const node = renderBootstrapError(error, options.document || globalThis.document);
    notifyFatal(options, error, node);
    return Promise.reject(error);
  }

  return Promise.resolve(startResult)
    .then(() => importApp())
    .catch((error) => {
      closeAfterFailure(client);
      const node = renderBootstrapError(error, options.document || globalThis.document);
      notifyFatal(options, error, node);
      throw error;
    });
}

export const start = bootstrap;
export const startApp = bootstrap;
export const bridge = bridgeClient;

let autoStartPromise = null;
export function autoStart(options = {}) {
  if (autoStartPromise) return autoStartPromise;
  autoStartPromise = bootstrap(options).catch(() => null);
  return autoStartPromise;
}

if (typeof document !== "undefined" && !globalThis.__CODEX_DISABLE_AUTO_BOOTSTRAP) {
  autoStart();
}

export default bootstrap;
