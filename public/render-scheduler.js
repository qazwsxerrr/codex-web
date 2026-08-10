const noop = () => {};

function frameApi(options = {}) {
  const requestFrame = options.requestFrame
    || globalThis.requestAnimationFrame?.bind(globalThis)
    || ((callback) => setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = options.cancelFrame
    || globalThis.cancelAnimationFrame?.bind(globalThis)
    || clearTimeout;
  return { requestFrame, cancelFrame };
}
/**
 * Coalesce arbitrary invalidations into one callback per animation frame.
 * The callback receives the set of keys invalidated since the previous frame.
 */
export function createKeyedFrameScheduler(callback = noop, options = {}) {
  const { requestFrame, cancelFrame } = frameApi(options);
  const keys = new Set();
  let frame = null;
  let disposed = false;

  const flush = () => {
    frame = null;
    if (disposed || !keys.size) return;
    const pending = new Set(keys);
    keys.clear();
    callback(pending);
  };

  return {
    schedule(key = "*") {
      if (disposed) return;
      keys.add(String(key));
      if (frame === null) frame = requestFrame(flush);
    },
    flush,
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      keys.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelFrame(frame);
      frame = null;
      keys.clear();
    },
    get pending() {
      return keys.size > 0;
    },
  };
}

/** Schedule non-urgent work without delaying explicit user actions. */
export function scheduleIdleTask(callback, options = {}) {
  const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 250;
  const requestIdle = options.requestIdleCallback || globalThis.requestIdleCallback;
  const cancelIdle = options.cancelIdleCallback || globalThis.cancelIdleCallback;
  if (typeof requestIdle === "function") {
    const handle = requestIdle.call(globalThis, callback, { timeout });
    return () => cancelIdle?.call(globalThis, handle);
  }
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const handle = setTimer(callback, 0);
  return () => clearTimer(handle);
}

/**
 * Run a long sequence in short frame slices. Cancellation is cooperative and
 * never rejects the returned promise, which keeps thread switches quiet.
 */
export function scheduleTimeSliced(items, process, options = {}) {
  const list = Array.isArray(items) ? items : [...(items || [])];
  const { requestFrame, cancelFrame } = frameApi(options);
  const now = options.now || (() => performance.now());
  const budgetMs = Math.max(1, Number(options.budgetMs ?? options.frameBudgetMs ?? 8) || 8);
  let index = 0;
  let frame = null;
  let cancelled = false;
  let settled = false;
  let resolvePromise = noop;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });

  const finish = (wasCancelled) => {
    if (settled) return;
    settled = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    resolvePromise({
      cancelled: Boolean(wasCancelled),
      completed: index,
      total: list.length,
      remaining: Math.max(0, list.length - index),
    });
  };

  const step = () => {
    frame = null;
    if (cancelled) {
      finish(true);
      return;
    }
    const deadline = now() + budgetMs;
    while (index < list.length && !cancelled && now() < deadline) {
      process(list[index], index);
      index += 1;
    }
    options.onProgress?.({ completed: index, total: list.length, remaining: list.length - index });
    if (cancelled) finish(true);
    else if (index >= list.length) finish(false);
    else frame = requestFrame(step);
  };

  frame = requestFrame(step);
  return {
    promise,
    cancel() {
      if (settled) return;
      cancelled = true;
      if (frame === null) finish(true);
    },
    get cancelled() {
      return cancelled;
    },
  };
}
