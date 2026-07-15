import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityDuration, isActiveTurnStatus, resolveTurnDurationMs, timestampToMs } from "../public/turn-activity.js";

test("formats CLI-style turn durations", () => {
  assert.equal(formatActivityDuration(0), "0s");
  assert.equal(formatActivityDuration(107_000), "1m 47s");
  assert.equal(formatActivityDuration(3_250_000), "54m 10s");
  assert.equal(formatActivityDuration(3_661_000), "1h 1m 1s");
});

test("resolves protocol timestamps and explicit durations", () => {
  assert.equal(timestampToMs(10), 10_000);
  assert.equal(timestampToMs(10_000), 10_000_000);
  assert.equal(resolveTurnDurationMs({ startedAt: 10, completedAt: 12 }, null, 99_000), 2_000);
  assert.equal(resolveTurnDurationMs({ durationMs: 250 }, 10_000, 20_000), 250);
  assert.equal(resolveTurnDurationMs({}, 10_000, 12_500), 2_500);
});

test("recognizes active turn statuses", () => {
  assert.equal(isActiveTurnStatus("inProgress"), true);
  assert.equal(isActiveTurnStatus("running"), true);
  assert.equal(isActiveTurnStatus("completed"), false);
});
