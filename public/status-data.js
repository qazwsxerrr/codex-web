export function unwrapConfig(configResult) {
  return configResult?.config || configResult?.effectiveConfig || configResult || {};
}

export function providerStatus(configResult, activeProvider) {
  const config = unwrapConfig(configResult);
  const providers = config.model_providers || config.modelProviders || {};
  const configuredName = activeProvider || config.model_provider || config.modelProvider || "default";
  const provider = providers[configuredName]
    || Object.values(providers).find((item) => item?.name === configuredName)
    || {};
  return {
    name: provider.name || configuredName,
    url: provider.base_url || provider.baseUrl || "default",
  };
}

function numeric(value, camel, snake) {
  return Number(value?.[camel] ?? value?.[snake] ?? 0);
}

export function threadTokenStats(tokenUsage) {
  const usage = tokenUsage || {};
  const last = usage.last || usage.lastTurn || {};
  const total = usage.total || {};
  const windowSize = numeric(usage, "modelContextWindow", "model_context_window");
  const contextUsed = numeric(last, "totalTokens", "total_tokens");
  const cachedInput = numeric(total, "cachedInputTokens", "cached_input_tokens");
  const rawInput = numeric(total, "inputTokens", "input_tokens");
  const input = Math.max(0, rawInput - cachedInput);
  const output = numeric(total, "outputTokens", "output_tokens");
  const totalUsed = input + output;
  const usedPercent = windowSize > 0 ? Math.min(100, (contextUsed / windowSize) * 100) : null;
  const leftPercent = usedPercent === null ? null : Math.max(0, 100 - usedPercent);
  return { usage, last, total, input, output, totalUsed, windowSize, contextUsed, usedPercent, leftPercent };
}

export function codexVersion(serverInfo) {
  const match = String(serverInfo?.userAgent || "").match(/\/(\d+\.\d+\.\d+)(?:\s|\()/);
  return match?.[1] || serverInfo?.version || "unknown";
}

export function formatCompactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 1_000_000) return `${stripZeros(number / 1_000_000, 2)}M`;
  if (Math.abs(number) >= 1_000) return `${stripZeros(number / 1_000, Math.abs(number) >= 100_000 ? 0 : 1)}K`;
  return new Intl.NumberFormat().format(number);
}

function stripZeros(value, digits) {
  return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}
