import assert from "node:assert/strict";
import test from "node:test";
import { codexVersion, formatCompactNumber, providerStatus, threadTokenStats } from "../public/status-data.js";

test("resolves the active compatible provider URL", () => {
  assert.deepEqual(providerStatus({
    config: {
      model_provider: "OpenAI",
      model_providers: {
        OpenAI: { name: "OpenAI", base_url: "https://gptpro.live/v1", wire_api: "responses" },
      },
    },
  }, "OpenAI"), { name: "OpenAI", url: "https://gptpro.live/v1" });
});

test("matches Codex CLI token and context accounting", () => {
  const stats = threadTokenStats({
    total: {
      totalTokens: 27_822_150,
      inputTokens: 27_665_772,
      cachedInputTokens: 25_826_304,
      outputTokens: 156_378,
    },
    last: { totalTokens: 265_389 },
    modelContextWindow: 353_400,
  });
  assert.equal(stats.input, 1_839_468);
  assert.equal(stats.output, 156_378);
  assert.equal(stats.totalUsed, 1_995_846);
  assert.equal(stats.contextUsed, 265_389);
  assert.equal(Math.round(stats.leftPercent), 25);
  assert.equal(formatCompactNumber(stats.totalUsed), "2M");
  assert.equal(formatCompactNumber(stats.input), "1.84M");
  assert.equal(formatCompactNumber(stats.output), "156K");
});

test("extracts the Codex CLI version from initialize userAgent", () => {
  assert.equal(codexVersion({ userAgent: "codex_math_web_v4/0.144.1 (Ubuntu; x86_64)" }), "0.144.1");
});
