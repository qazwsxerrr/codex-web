# Changelog

## Workspace UI refresh

- Rebuilt the page as a responsive Codex workspace with Activity Rail,
  conversations, shared Conversation/Changes/Commands views, and Session
  Inspector.
- Added safe unified-diff rendering, command activity, structured mention/image
  input, official remote thread search, browser-local thread navigation, and
  per-thread scroll restoration.
- Added and pinned `lucide@1.24.0`, while preserving Markdown, DOMPurify, KaTeX,
  App Server approvals, MCP, Slash commands, and thread settings.
- Updated protocol contracts and the Slash catalog for Codex CLI 0.144.3.

## 0.4.4

- Added a recent-conversations sidebar backed by the official App Server
  `thread/list` RPC with cursor pagination and explicit unsupported fallback.
- Added title/first-message fallback, Today/Yesterday/This Week grouping, local
  search filtering, current-thread highlighting, and one-click `thread/resume`.
- Moved manual Thread ID resume into a secondary details control and added the
  primary New Conversation action to the sidebar.

## 0.4.3

- Fixed `/mcp` tool counts for the current object-shaped app-server response.
- Replaced invented `unknown` status fields with real MCP server metadata,
  configured enablement, transport, URL or command, authentication, tools,
  resources, templates, and optional startup notifications.
- Added verbose tool descriptions, safe environment-variable names, and timeout
  settings without exposing environment values or bearer tokens.

## 0.4.2

- Expanded `/status` with the actual compatible-provider URL and Codex CLI
  version reported by app-server initialization.
- Fixed resumed-thread token usage being dropped when its notification arrives
  before `thread/resume` completes.
- Matched the CLI token accounting by excluding cached input from cumulative
  usage while keeping full last-turn tokens for context-window usage.
- Added CLI-style token totals, context remaining, and collaboration mode.

## 0.4.1

- Moved the Codex CLI 0.144.1 Linux/WSL Slash catalog, aliases, and conditional
  platform commands into a structured module.
- Implemented `/plan` and `/personality` with `thread/settings/update`.
- Corrected `/approve` to use the guardian denial retry API rather than accepting
  an unrelated pending approval.
- Added a generated app-server schema contract test for Slash-command RPCs.
- Replaced raw dialogs for `/model`, `/permissions`, `/personality`, and `/skills`
  with a composer-anchored selectable palette supporting mouse, arrows, Enter,
  and Escape.

## 0.4.0

- Fixed Enter handling in the slash palette: a highlighted complete command is
  executed instead of submitting the partial prefix.
- Added Tab-only completion and argument-aware completion for `/rename`.
- Synchronized the Linux/WSL release command-name catalog with Codex CLI 0.144.1,
  while retaining the dynamic `/fast` command and native aliases.
- Removed non-native `/reasoning` and `/help` palette entries.
- Added real App Server implementations for `/review`, `/rename`, `/archive`,
  `/delete`, `/goal`, `/memories`, `/ps`, `/stop`, `/logout`, and correct `/clear`
  new-session behavior.
- Corrected `/stop`: it now stops background terminals; the page Stop button
  continues to interrupt the active turn.
- Commands that require TUI/IDE-specific state are explicitly disabled instead of
  acting as empty placeholders.

## 0.3.0

- Added `/mcp`, `/mcp verbose`, and `/mcp reload` using
  `mcpServerStatus/list` and `config/mcpServer/reload`.
- Added skills, hooks, apps, plugins, usage, and config-diagnostics commands.
- Removed `/math-test` from the production slash-command surface.
- Expanded the Codex-style slash-command catalog and marked TUI/IDE-only commands
  as unavailable in the web client.

## 0.2.0

- Correct KaTeX rendering.
- Model/reasoning controls and live session status.
