const ACTIVE_WRITER_MESSAGES = [
  /already has an active writer/i,
  /already has a live local writer/i,
  /thread-store conflict:[^\n]*writer/i,
];

function errorMessages(error) {
  return [
    error?.message,
    error?.data?.message,
    error?.data?.error?.message,
  ].filter((value) => typeof value === "string");
}

/**
 * Codex App Server returns a JSON-RPC error when another Codex client owns the
 * rollout writer. Keep this check narrow so unrelated resume errors are not
 * silently converted into a history snapshot.
 */
export function isActiveWriterConflict(error) {
  const code = Number(error?.code);
  return errorMessages(error).some((message) => ACTIVE_WRITER_MESSAGES.some((pattern) => pattern.test(message)))
    && (code === -32600 || code === 0 || error?.code === undefined || error?.code === null);
}

/**
 * Resume a thread with write access when possible. If another Codex client
 * owns the rollout writer, return the saved thread snapshot instead of making
 * the whole conversation unavailable.
 */
export async function resumeThreadWithFallback(request, threadId) {
  try {
    return {
      result: await request("thread/resume", { threadId }),
      writerConflict: null,
    };
  } catch (error) {
    if (!isActiveWriterConflict(error)) throw error;
    return {
      result: await request("thread/read", { threadId, includeTurns: true }),
      writerConflict: error,
    };
  }
}
