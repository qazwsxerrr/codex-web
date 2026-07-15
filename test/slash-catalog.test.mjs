import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_CLI_VERSION,
  platformCommands,
  slashAliases,
  slashCommands,
} from "../public/slash-commands.js";

const expected = [
  "/model", "/fast", "/ide", "/permissions", "/keymap", "/vim",
  "/setup-default-sandbox", "/experimental", "/approve", "/memories",
  "/skills", "/import", "/hooks", "/review", "/rename", "/new",
  "/archive", "/delete", "/resume", "/fork", "/init", "/compact",
  "/plan", "/goal", "/agent", "/side", "/btw", "/copy", "/raw",
  "/diff", "/mention", "/status", "/usage", "/debug-config", "/title",
  "/statusline", "/theme", "/pets", "/mcp", "/apps", "/plugins",
  "/logout", "/quit", "/exit", "/feedback", "/ps", "/stop", "/clear",
  "/personality", "/subagents", "/debug-m-drop", "/debug-m-update",
];

test("contains the Codex CLI 0.144.3 Linux/WSL release catalog plus dynamic /fast", () => {
  assert.equal(CODEX_CLI_VERSION, "0.144.3");
  assert.deepEqual(slashCommands.map((command) => command.name), expected);
});

test("accepts native aliases without duplicate palette entries", () => {
  assert.equal(slashAliases.get("/clean"), "/stop");
  assert.equal(slashAliases.get("/pet"), "/pets");
  assert.ok(!slashCommands.some((command) => slashAliases.has(command.name)));
});

test("tracks platform and debug-only commands separately", () => {
  assert.deepEqual(platformCommands.map((command) => command.name), [
    "/app", "/sandbox-add-read-dir", "/rollout", "/test-approval",
  ]);
});

test("every command declares its Web support state", () => {
  for (const command of slashCommands) {
    assert.ok(["implemented", "unsupported"].includes(command.support), command.name);
    assert.equal(command.unavailable, command.support !== "implemented", command.name);
  }
  assert.equal(slashCommands.find((command) => command.name === "/plan")?.support, "implemented");
  assert.equal(slashCommands.find((command) => command.name === "/personality")?.support, "implemented");
  assert.equal(slashCommands.find((command) => command.name === "/mention")?.support, "implemented");
});
