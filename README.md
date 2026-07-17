# Codex Web Workspace

A lightweight local browser client for `codex app-server` with Markdown/KaTeX,
model and reasoning controls, live thread status, and a Codex CLI 0.144.3-aware
slash-command palette for Linux/WSL.

## Workspace views

- Conversation keeps restored and streaming messages, tool activity, approvals,
  Markdown, and KaTeX in one transcript.
- Changes renders real unified diffs with file statistics, old/new line numbers,
  safe text rendering, and paged output for large files.
- Commands shows the real command, cwd, status, duration, exit code, and combined
  output reported by App Server.
- Session Inspector synchronizes model, reasoning, permissions, service tier,
  provider, cwd, context usage, MCP inventory, Thread ID, and connection state.
- The shared composer supports native file mentions through `fuzzyFileSearch`
  and up to four image inputs of 10 MB each.

## Recent conversations

The left sidebar uses the official App Server `thread/list` RPC, ordered by
`recency_at`, with cursor-based pagination. It shows `name` when a thread has a
user-facing title and falls back to the first-user-message `preview`. Sessions
are grouped into Today, Yesterday, This Week, and Earlier and can be filtered
locally by title, preview, or working directory.

Selecting a conversation resumes it through `thread/resume`. Manual Thread ID
resume remains available as a secondary control. If an older App Server does not
support `thread/list`, the sidebar reports that limitation and keeps manual
resume available instead of presenting a synthetic history list.

## What v4 fixes

- Pressing Enter on a highlighted slash suggestion now executes the complete
  selected command. Typing `/s`, highlighting `/status`, and pressing Enter no
  longer submits the incomplete text `/s`.
- Tab completes a command without executing it.
- Commands that require arguments, such as `/rename`, complete to `/rename `
  instead of executing an empty command.
- The palette follows the Codex CLI 0.144.3 Linux/WSL command order and accepts
  the native aliases `/clean` -> `/stop` and `/pet` -> `/pets`.
- `/fast` is retained as the model service-tier command exposed dynamically by
  the Codex TUI.
- The command catalog now lives in `public/slash-commands.js`, including native
  aliases and platform/debug-only command metadata, so tests validate structured
  command data instead of scanning source text.
- `/plan` now switches the active thread to the App Server Plan collaboration
  mode, and `/personality` updates the active thread personality.
- `/approve` now retries a real auto-review denial through
  `thread/approveGuardianDeniedAction`; it no longer accepts an unrelated pending
  tool approval.
- `/model`, `/permissions`, `/personality`, and `/skills` now use a keyboard and
  mouse selectable palette above the composer instead of a raw text dialog.
  Selecting a skill inserts its native `$skill-name` mention into the composer.
- Removed the non-native `/reasoning`, `/help`, and `/math-test` entries from the
  production command palette.

## Functional commands

These commands call real App Server APIs or perform a real browser-client action:

```text
/model              /fast                /permissions
/experimental       /approve             /memories
/skills              /hooks               /review
/rename              /new                 /archive
/delete              /resume              /fork
/compact             /plan                /goal
/personality         /copy
/diff                /mention             /status
/usage
/debug-config        /mcp                 /apps
/plugins             /logout              /quit
/exit                /ps                  /stop
/clear
```

Commands that require the Codex terminal TUI or an IDE host remain visible but
are greyed out and explicitly report that they are unavailable. They are not
silently treated as successful empty commands.

The command-name catalog is complete for a release build of Codex CLI 0.144.3
running on Linux/WSL, plus the dynamic `/fast` service-tier command. Platform-
hidden commands such as `/app` and `/sandbox-add-read-dir`, and debug-build-only
commands such as `/rollout` and `/test-approval`, are intentionally not shown.

## Install

Do not copy an old `node_modules` or `package-lock.json` into this directory.

```bash
cd /path/to/codex-web
bash install.sh
```

## Start

The server reads `config.yaml` from this project directory (with `config.yml`
and the legacy `config.json` as fallbacks). It contains `codexBin`,
`projectCwd`, `host`, and `port`; environment variables with the same names
(`CODEX_BIN`, `PROJECT_CWD`, `HOST`, and `PORT`) take precedence. See
`config.example.yaml` for a native Windows example.
Use native Windows paths when the server is running under native Windows, for
example `C:\\Users\\admin\\bin\\codex.exe` and
`D:\\ai_code\\ai_vibecode\\codex-web`.

```bash
cd /path/to/codex-web
PROJECT_CWD=/mnt/d/ai_code/ai_project/ct_time npm start
```

Open:

```text
http://127.0.0.1:4317
```

If an older version is still using port 4317:

```bash
PORT=4318 PROJECT_CWD=/mnt/d/ai_code/ai_project/ct_time npm start
```

## Slash selection behavior

- Type `/sta`, then press Enter: executes `/status` when it is highlighted.
- Type `/mcp verbose`, then press Enter: preserves and executes the argument.
- Type `/ren`, then press Enter: completes to `/rename ` and waits for a name.
- Use Up/Down to change the highlighted command.
- `/model` opens model and reasoning-effort pickers; use Up/Down and Enter.
- `/skills` opens the available Skill picker and inserts the selected `$skill`.
- Use Tab to complete without executing.

## Architecture limitation

This is a browser client for Codex App Server. It can list, resume, and operate
the same threads, but it does not mirror terminal pixels or the local input state of a
simultaneously running Codex TUI. Do not drive one active thread from both clients
at the same time.

## Security

The server binds to `127.0.0.1` by default. Keep it local because it can approve
commands, edit files, archive/delete threads, and log out the Codex account.
