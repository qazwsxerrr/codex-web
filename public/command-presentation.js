const STATUS_LABELS = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  denied: "Denied",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

const READONLY_COMMANDS = new Set([
  "cat", "cut", "du", "file", "head", "less", "ls", "more", "nl", "pwd",
  "find", "rg", "grep", "sed", "sort", "stat", "tail", "tree", "uniq", "wc",
]);

// These commands expose file contents directly, so they get the compact
// `read` label even though Codex reports the protocol item as bash.
const READ_TOOL_COMMANDS = new Set(["cat", "sed", "head", "tail", "nl", "less", "more"]);

const WRITE_COMMANDS = new Set([
  "chmod", "chown", "cp", "install", "mkdir", "mv", "rm", "rmdir", "tee", "touch",
]);

const READONLY_GIT_COMMANDS = new Set(["branch", "diff", "log", "show", "status"]);
const WRITE_GIT_COMMANDS = new Set([
  "add", "apply", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "pull",
  "push", "rebase", "reset", "restore", "rm", "switch", "tag",
]);

function asText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function commandBase(value) {
  return asText(value).replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)?.toLowerCase() || "";
}

function safeFirstLine(value, maxLength = 180) {
  const first = asText(value).replace(/\r\n?/g, "\n").split("\n").find((line) => line.trim())?.trim() || "";
  return first.length > maxLength ? `${first.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...` : first;
}

function truncateText(value, maxLength) {
  const text = asText(value).replace(/\s+/g, " ").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function shellTokens(source) {
  const text = asText(source);
  const tokens = [];
  let value = "";
  let quote = "";
  let escaped = false;

  const push = () => {
    if (value) tokens.push({ value, operator: false });
    value = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = "";
      else value += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = "";
      else if (char === "\\" && index + 1 < text.length) escaped = true;
      else value += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if ("|&;<>".includes(char)) {
      push();
      const next = text[index + 1];
      if ((char === "|" && next === "|") || (char === "&" && next === "&") || (char === ">" && next === ">") || (char === "<" && next === "<")) {
        tokens.push({ value: `${char}${next}`, operator: true });
        index += 1;
      } else {
        tokens.push({ value: char, operator: true });
      }
      continue;
    }
    value += char;
  }
  if (quote || escaped) return null;
  push();
  return tokens;
}

function tokenValues(tokens) {
  return (tokens || []).map((token) => token.value);
}

function serializeValues(values) {
  return values.map((value) => {
    const text = asText(value);
    if (!/[\s]/.test(text)) return text;
    return `'${text.replace(/'/g, "'\\''")}'`;
  }).join(" ").trim();
}

function matchingOuterQuote(value) {
  const text = asText(value).trim();
  if (text.length < 2 || !["'", '"'].includes(text[0]) || text.at(-1) !== text[0]) return null;
  let escaped = false;
  let quoteCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && text[0] === '"') {
      escaped = true;
      continue;
    }
    if (char === text[0]) {
      quoteCount += 1;
      if (quoteCount === 2 && index !== text.length - 1) return null;
    }
  }
  return quoteCount === 2 ? text.slice(1, -1).trim() : null;
}

function hasHeredoc(value) {
  return /(^|\s|[;&|])<<-?\s*/.test(asText(value));
}

function isShellFlag(value) {
  return /^-{1,2}(?:c|lc|cl|l?c|c?l)$/.test(value) || value === "--command";
}

function unwrapOnce(value) {
  const outer = matchingOuterQuote(value);
  if (outer !== null) return { value: outer, changed: true };
  const tokens = shellTokens(value);
  if (!tokens?.length) return { value: asText(value).trim(), changed: false };
  const values = tokenValues(tokens);
  const first = commandBase(values[0]);

  if ((first === "bash" || first === "sh" || first === "dash" || first === "zsh") && isShellFlag(values[1]) && values[2]) {
    return { value: values[2], changed: true };
  }

  if (first === "wsl.exe" || first === "wsl") {
    if (commandBase(values[1]) === "bash" || commandBase(values[1]) === "sh") {
      return { value: serializeValues(values.slice(1)), changed: true };
    }
    return { value: asText(value).trim(), changed: false };
  }

  if (first === "env") {
    let index = 1;
    while (index < values.length && (values[index] === "-i" || values[index] === "--ignore-environment")) index += 1;
    if (values[index] === "--") index += 1;
    while (index < values.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(values[index])) index += 1;
    if (index < values.length) return { value: serializeValues(values.slice(index)), changed: true };
  }

  if (first === "timeout") {
    let index = 1;
    while (index < values.length && values[index].startsWith("-")) {
      index += ["-k", "--kill-after"].includes(values[index]) ? 2 : 1;
    }
    if (/^(?:\d+(?:\.\d+)?)(?:s|m|h|d)?$/.test(values[index] || "")) index += 1;
    if (index < values.length) return { value: serializeValues(values.slice(index)), changed: true };
  }

  if (first === "time" && (asText(values[0]).includes("/time") || values[0] === "time")) {
    let index = 1;
    while (index < values.length && values[index].startsWith("-")) {
      index += ["-o", "--output", "-f", "--format"].includes(values[index]) ? 2 : 1;
    }
    if (index < values.length) return { value: serializeValues(values.slice(index)), changed: true };
  }

  return { value: asText(value).trim(), changed: false };
}

export function unwrapShellCommand(rawCommand) {
  let current = asText(rawCommand).trim();
  if (!current) return "";
  for (let depth = 0; depth < 4; depth += 1) {
    if (hasHeredoc(current)) return safeFirstLine(current);
    const next = unwrapOnce(current);
    if (!next.changed || !next.value || next.value === current) return current;
    current = next.value.trim();
  }
  return hasHeredoc(current) ? safeFirstLine(current) : current;
}

function splitSegments(value) {
  const tokens = shellTokens(value);
  if (!tokens) return [];
  const segments = [[]];
  for (const token of tokens) {
    if (["|", "||", "&&", ";"].includes(token.value)) segments.push([]);
    else segments.at(-1).push(token.value);
  }
  return segments.filter((segment) => segment.length);
}

function optionOperands(args, optionsWithValues = new Set()) {
  const operands = [];
  let afterDoubleDash = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (afterDoubleDash) {
      operands.push(value);
      continue;
    }
    if (value === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (value.startsWith("-")) {
      if (optionsWithValues.has(value)) index += 1;
      else if (optionsWithValues.has(value.split("=")[0]) && value.includes("=")) continue;
      continue;
    }
    operands.push(value);
  }
  return operands;
}

function displayPath(value) {
  const text = asText(value).replace(/^\.\//, "").replace(/[\\/]+$/, "");
  if (!text) return "文件";
  return text.split(/[\\/]/).at(-1) || text;
}

function findLineRange(segments) {
  for (const segment of segments) {
    for (const value of segment) {
      const match = value.match(/^(\d+)\s*,\s*(\d+)(?:p)?$/i);
      if (match) return { kind: "range", start: Number(match[1]), end: Number(match[2]) };
    }
  }
  return null;
}

function findTailCount(segments, command) {
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const value = segment[index];
      if (["-n", "--lines"].includes(value) && /^\d+$/.test(segment[index + 1] || "")) return Number(segment[index + 1]);
      if (/^(?:-n|--lines)=\d+$/.test(value)) return Number(value.split("=")[1]);
    }
  }
  return command === "tail" ? 10 : command === "head" ? 10 : null;
}

function findReadPath(segments) {
  for (const segment of segments) {
    const command = commandBase(segment[0]);
    const operands = optionOperands(segment.slice(1), new Set(["-e", "--regexp", "-f", "--file", "-n", "--lines", "-C", "--context"]));
    if (["sed"].includes(command)) {
      const path = operands.find((value) => !/^\d+(?:,\d+)?p?$/.test(value));
      if (path) return path;
    } else if (["nl", "cat", "head", "tail", "less", "more"].includes(command) && operands[0]) {
      return operands[0];
    }
  }
  return "";
}

function searchSummary(segments, command) {
  const segment = segments.find((part) => commandBase(part[0]) === command) || [];
  if (segment.includes("--files")) {
    const paths = optionOperands(segment.slice(1)).slice(0, 2).map(displayPath);
    return paths.length ? `列出 ${paths.join("、")} 中的文件` : "列出项目文件";
  }
  const operands = optionOperands(segment.slice(1), new Set(["-e", "--regexp", "-f", "--file", "-g", "--glob", "-t", "--type", "-T", "--type-not"]));
  const pattern = operands[0] || "搜索内容";
  const paths = operands.slice(1, 3).map(displayPath);
  return `搜索 “${truncateText(pattern, 34)}”${paths.length ? ` · ${paths.join("、")}` : ""}`;
}

function fallbackSummary(displayCommand, maxLength) {
  const first = safeFirstLine(displayCommand, Math.max(maxLength, 140));
  const base = commandBase(first.split(/\s+/, 1)[0]);
  if (["python", "python3", "node"].includes(base)) return truncateText(`运行 ${base === "node" ? "Node" : "Python"} 命令`, maxLength);
  return truncateText(first || "执行命令", maxLength);
}

function commandActionsCategory(actions) {
  if (!Array.isArray(actions)) return "";
  const types = new Set(actions.map((action) => action?.type));
  if (types.has("search") || types.has("listFiles")) return "search";
  if (types.has("read")) return "read";
  return "";
}

function summarizeCommandActions(actions, maxLength) {
  if (!Array.isArray(actions)) return "";
  const search = actions.find((action) => action?.type === "search");
  if (search) {
    const query = search.query || "";
    return query ? truncateText(`搜索 “${query}”`, maxLength) : "搜索项目文件";
  }
  if (actions.some((action) => action?.type === "listFiles")) return "列出项目文件";
  const read = actions.find((action) => action?.type === "read");
  return read ? `查看 ${displayPath(read.path)}` : "";
}

function searchToolText(item) {
  const actionText = Array.isArray(item?.commandActions)
    ? item.commandActions.flatMap((action) => [action?.type, action?.query, action?.path])
    : [];
  return [item?.server, item?.tool, item?.name, item?.command, item?.action?.type, ...actionText]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const SEARCH_TOOL_PATTERN = /(?:^|[\s:./_-])(?:search|find|grep|rg|ripgrep|glob|filesearch|searchfiles|listfiles)(?=$|[\s:./_-])/;

export function searchActivityLabel(item) {
  if (!item || typeof item !== "object") return "";
  if (item.type === "webSearch") return "Searching web...";
  if (item.type === "commandExecution") {
    const command = unwrapShellCommand(item.command);
    const names = splitSegments(command).map((segment) => commandBase(segment[0]));
    if (commandActionsCategory(item.commandActions) === "search"
      || classifyCommand(command).category === "search"
      || names.some((name) => ["find", "grep", "rg"].includes(name))) {
      return "Searching files...";
    }
  }
  if (["mcpToolCall", "dynamicToolCall"].includes(item.type) && SEARCH_TOOL_PATTERN.test(searchToolText(item))) {
    return "Searching files...";
  }
  return "";
}

function commandCategoryFromSegments(segments, source) {
  const names = segments.map((segment) => commandBase(segment[0]));
  if (names.some((name) => ["rg", "grep"].includes(name)
    || /(?:^|[-_])search(?:$|[-_])/.test(name))) return "search";
  if (names.some((name) => ["pytest", "jest", "vitest"].includes(name))) return "test";
  if (names.some((name) => name === "npm" && /(?:^|\s)(?:test|run\s+(?:test|check|lint))/.test(source))) return "test";
  if (names.some((name) => name === "node" && segments.some((segment) => segment.includes("--test")))) return "test";
  if (names.some((name) => ["make", "tsc", "vite", "webpack", "cargo"].includes(name))) return "build";
  if (names.some((name) => name === "npm" && segments.some((segment) => segment[1] === "run" && /build|compile/.test(segment[2] || "")))) return "build";
  if (names.some((name) => ["git"].includes(name))) return "git";
  if (names.some((name) => READONLY_COMMANDS.has(name))) return "read";
  if (names.some((name) => ["python", "python3", "node", "npx"].includes(name) || name.startsWith("python3."))) return "runner";
  if (names.some((name) => WRITE_COMMANDS.has(name))) return "write";
  return "unknown";
}

function pythonCode(segment) {
  const index = segment.findIndex((value) => value === "-c" || value === "--command");
  return index >= 0 ? segment[index + 1] || "" : "";
}

function pythonCodeLooksReadonly(code) {
  const text = asText(code);
  if (!text || /(?:write_text|write_bytes|unlink|rmdir|mkdir|rename|replace|shutil\.|subprocess\.|os\.system|to_csv|dump\s*\(|open\s*\([^)]*['\"](?:w|a|x))/.test(text)) return false;
  return /(?:print\s*\(|read_text|read_bytes|glob\s*\(|rglob\s*\(|exists\s*\(|is_file\s*\(|json\.load|Path\s*\()/.test(text);
}

function segmentIsReadonly(segment, source) {
  const command = commandBase(segment[0]);
  const args = segment.slice(1);
  if (!command || WRITE_COMMANDS.has(command) || command === "tee") return false;
  if (command === "sed" && (args.includes("-i") || args.includes("--in-place"))) return false;
  if (command === "find" && args.some((value) => ["-delete", "-exec", "-execdir"].includes(value))) return false;
  if (command === "xargs") return false;
  if (command === "git") return READONLY_GIT_COMMANDS.has(args[0]);
  if (command === "npm") {
    if (["install", "i", "ci", "uninstall", "update", "publish", "link"].includes(args[0])) return false;
    return args[0] === "test" || (args[0] === "run" && ["check", "test", "lint"].includes(args[1])) || args[0] === "list";
  }
  if (command === "npx") return false;
  if (command === "python" || command === "python3" || command.startsWith("python3.")) return pythonCodeLooksReadonly(pythonCode(segment));
  if (command === "node") return args.includes("--test") || Boolean(args[0] && !args[0].startsWith("-")) ? false : false;
  if (READONLY_COMMANDS.has(command)) return true;
  return false;
}

function hasWriteSignal(source, segments) {
  if (segments.some((segment) => segment.some((value) => [">", ">>", "<<"].includes(value)))) return true;
  if (/(^|\s)(?:tee|rm|mv|cp|mkdir|touch|chmod|chown)(?:\s|$)/.test(source)) return true;
  if (/(^|\s)(?:sudo\s+)?(?:npm|pnpm|yarn|pip|apt(?:-get)?)(?:\s+[^\n]*)?\s+(?:install|i|ci|add|remove|uninstall|update)(?:\s|$)/.test(source)) return true;
  return false;
}

export function normalizeToolStatus(status) {
  const raw = typeof status === "object"
    ? status?.kind || status?.status || status?.state || status?.type || status?.result
    : status;
  const value = asText(raw).replace(/[\s_-]/g, "").toLowerCase();
  const kind = value === "inprogress" || value === "running" || value === "started" || value === "active" || value === "processing" || value === "cancelling" || value === "pending"
    ? "running"
    : value === "completed" || value === "complete" || value === "succeeded" || value === "success"
      ? "completed"
      : value === "denied" || value === "rejected" || value === "forbidden"
        ? "denied"
        : value === "failed" || value === "failure" || value === "error" || value === "errored"
        ? "failed"
          : value === "cancelled" || value === "canceled" || value === "aborted" || value === "stopped" || value === "interrupted"
            ? "cancelled"
            : "unknown";
  return { kind, label: STATUS_LABELS[kind], isActive: kind === "running", isFailure: kind === "failed" || kind === "denied" };
}

const PREVIEW_KEYS = ["command", "path", "file_path", "pattern", "query"];

function inputObjects(item = {}) {
  return ["input", "arguments", "params", "parameters"]
    .map((key) => item?.[key])
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Return the raw value used by the compact Pi-style tool title.  Keep this
 * deliberately boring: the title should expose the protocol input, not a
 * translated summary.  The complete value is still available through
 * `toolInputText` for the expanded pane and the title attribute.
 */
export function toolPreviewValue(item = {}) {
  const inputs = inputObjects(item);
  for (const key of PREVIEW_KEYS) {
    if (item?.[key] !== undefined && item?.[key] !== null) return item[key];
    for (const input of inputs) {
      if (input[key] !== undefined && input[key] !== null) return input[key];
    }
  }
  if (item?.commandLine !== undefined) return item.commandLine;
  if (item?.rawCommand !== undefined) return item.rawCommand;
  if (item?.searchQuery !== undefined) return item.searchQuery;
  if (item?.filePath !== undefined) return item.filePath;
  if (item?.file !== undefined) return item.file;
  for (const key of ["input", "arguments", "params", "parameters"]) {
    if (item?.[key] !== undefined) return item[key];
  }
  if (item?.type === "fileChange" || item?.viewType === "change") {
    const changes = Array.isArray(item.changes) ? item.changes : Array.isArray(item.files) ? item.files : [];
    const firstPath = changes[0]?.path ?? changes[0]?.filePath ?? changes[0]?.file_path;
    if (firstPath) return firstPath;
    if (changes.length) return `${changes.length} file${changes.length === 1 ? "" : "s"}`;
  }
  if (item?.input !== undefined) return item.input;
  if (item?.text !== undefined) return item.text;
  if (item?.message !== undefined) return item.message;
  return "";
}

function rawToolInput(item = {}) {
  return toolPreviewValue(item);
}

export function toolInputText(item = {}) {
  const value = rawToolInput(item);
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return "[unserializable input]"; }
}

export function toolInputPreview(item = {}, options = {}) {
  const requested = typeof options === "number" ? options : options?.maxLength;
  const maxLength = Number(requested) > 0 ? Number(requested) : 120;
  const value = toolInputText(item).replace(/\s+/g, " ").trim();
  // CSS owns the visual ellipsis.  Returning a hard 120-character prefix
  // avoids making the protocol input look like it literally contains `...`.
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();
}

// Pi Web names this pure helper `getToolPreview`; keep the alias explicit so
// native callers and tests can use the same vocabulary without importing UI.
export function getToolPreview(item = {}) {
  return toolInputPreview(item, { maxLength: 120 });
}

export function countOutputLines(output) {
  const text = asText(output).replace(/\r\n?/g, "\n");
  if (!text) return 0;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function tailOutputLines(output, limit = 5) {
  const text = asText(output).replace(/\r\n?/g, "\n");
  if (!text || !Number.isFinite(Number(limit)) || Number(limit) <= 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-Math.floor(Number(limit)));
}

export function classifyCommand(rawCommand, options = {}) {
  const displayCommand = unwrapShellCommand(rawCommand);
  const segments = splitSegments(displayCommand);
  const source = displayCommand.replace(/\r\n?/g, " ");
  const category = commandCategoryFromSegments(segments, source);
  const known = segments.length > 0 && segments.every((segment) => segmentIsReadonly(segment, source));
  const write = hasWriteSignal(source, segments) || segments.some((segment) => {
    const command = commandBase(segment[0]);
    const args = segment.slice(1);
    return (command === "git" && (WRITE_GIT_COMMANDS.has(args[0])
      || (args[0] === "branch" && args.some((value) => ["-d", "-D", "--delete", "-m", "-M", "--move", "--copy"].includes(value)))
      || (args[0] === "diff" && args.some((value) => value === "--output" || value === "-o"))))
      || (command === "find" && args.some((value) => ["-delete", "-exec", "-execdir"].includes(value)));
  });
  const readonly = !write && known;
  const durationMs = Number(options.durationMs);
  let standaloneReason = "";
  if (!segments.length) standaloneReason = "empty command";
  else if (write) standaloneReason = "writes files or state";
  else if (!readonly) standaloneReason = "command is not a known read-only operation";
  else if (["test", "build", "write"].includes(category) || (category === "runner" && !readonly)) standaloneReason = `${category} command`;
  else if (Number.isFinite(durationMs) && durationMs >= 5000) standaloneReason = "long-running command";
  const groupable = readonly && !standaloneReason;
  return { category, readonly, groupable, standaloneReason };
}

export function commandEnvironmentLabel(rawCommand, options = {}) {
  const raw = asText(rawCommand).trim();
  if (/^(?:\/[^\s]+\/)?wsl(?:\.exe)?(?:\s|$)/i.test(raw)) return "WSL";
  if (/^(?:\/[^\s]+\/)?(?:bash|sh|dash|zsh)(?:\s|$)/i.test(raw)) return "Shell";
  const first = commandBase(unwrapShellCommand(raw).split(/\s+/, 1)[0]);
  if (first === "git") return "Git";
  if (first === "python" || first === "python3" || first.startsWith("python3.")) return "Python";
  if (["npm", "npx", "node", "pnpm", "yarn"].includes(first)) return "Node";
  if (first === "bash" || first === "sh") return "Shell";
  return options.fallback || "Terminal";
}

export function commandToolName(itemOrCommand = {}) {
  if (typeof itemOrCommand === "object" && itemOrCommand !== null) {
    if (itemOrCommand.type === "read" || itemOrCommand.viewType === "read") return "read";
    if (Array.isArray(itemOrCommand.commandActions)
      && itemOrCommand.commandActions.some((action) => action?.type === "read")) return "read";
  }
  const rawCommand = typeof itemOrCommand === "string"
    ? itemOrCommand
    : itemOrCommand?.command ?? itemOrCommand?.commandLine ?? itemOrCommand?.rawCommand ?? "";
  const names = splitSegments(unwrapShellCommand(rawCommand)).map((segment) => commandBase(segment[0]));
  return names.some((name) => READ_TOOL_COMMANDS.has(name)) ? "read" : "bash";
}

export function toolType(item = {}) {
  if (item?.type === "commandExecution") return commandToolName(item);
  if (item?.type === "webSearch" || item?.viewType === "search") return "web_search";
  if (item?.type === "fileChange" || item?.viewType === "change") return "edit";
  if (item?.type === "mcpToolCall") return item.tool || "mcp";
  if (item?.type === "read" || item?.viewType === "read") return "read";
  return item?.tool || item?.name || item?.type || "tool";
}

export const getToolType = toolType;

export function summarizeCommand(rawCommand, options = {}) {
  const maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 96;
  const displayCommand = unwrapShellCommand(rawCommand);
  const segments = splitSegments(displayCommand);
  const first = commandBase(segments[0]?.[0]);
  let summary = "";
  if (["rg", "grep"].includes(first)) summary = searchSummary(segments, first);
  else if (["sed", "nl", "cat", "head", "tail", "less", "more"].includes(first)) {
    const path = displayPath(findReadPath(segments));
    const range = findLineRange(segments);
    const count = findTailCount(segments, first);
    if (range) summary = `查看 ${path} 第 ${range.start}–${range.end} 行`;
    else if (first === "tail") summary = `查看 ${path} 末尾 ${count} 行`;
    else if (first === "head") summary = `查看 ${path} 前 ${count} 行`;
    else summary = `查看 ${path}`;
  } else if (first === "git") {
    const subcommand = segments[0]?.[1] || "";
    summary = subcommand === "status" ? "查看 Git 状态"
      : subcommand === "diff" ? "查看 Git diff"
        : subcommand === "log" ? "查看 Git 日志"
          : subcommand === "show" ? "查看 Git 提交详情"
            : `Git 操作${subcommand ? ` · ${subcommand}` : ""}`;
  } else if (first === "pwd") summary = "查看当前目录";
  else if (["ls", "tree"].includes(first)) summary = "列出项目文件";
  else if (first === "find") summary = "查找项目文件";
  else if (/(?:^|[-_])search(?:$|[-_])/.test(first)) summary = "搜索项目内容";
  else if (["pytest", "jest", "vitest"].includes(first) || (first === "npm" && (segments[0]?.[1] === "test" || (segments[0]?.[1] === "run" && ["test", "check", "lint"].includes(segments[0]?.[2])))) || (first === "node" && segments[0]?.includes("--test"))) summary = "运行测试";
  else if (first === "npm" && segments[0]?.[1] === "run") summary = `运行 npm ${segments[0]?.[2] || "脚本"}`;
  else if (["make", "tsc", "vite", "webpack", "cargo"].includes(first)) summary = "构建项目";
  else if (["python", "python3", "node"].includes(first) || first.startsWith("python3.")) {
    const script = segments[0]?.find((value, index) => index > 0 && !value.startsWith("-") && !segments[0]?.[index - 1]?.startsWith("-"));
    summary = script && /\.(?:py|mjs|js|ts)$/.test(script) ? `运行 ${displayPath(script)}` : `运行 ${first.startsWith("python") ? "Python" : "Node"} 命令`;
  } else if (["mkdir", "cp", "mv", "rm", "touch", "tee"].includes(first)) summary = "更新项目文件";
  else summary = fallbackSummary(displayCommand, maxLength);
  return truncateText(summary || "执行命令", maxLength);
}

export function presentCommand(itemOrCommand, options = {}) {
  const item = itemOrCommand && typeof itemOrCommand === "object" ? itemOrCommand : {};
  const rawCommand = typeof itemOrCommand === "string"
    ? itemOrCommand
    : item.command ?? item.commandLine ?? item.rawCommand ?? "";
  const raw = asText(rawCommand);
  const displayCommand = unwrapShellCommand(raw);
  const normalizedStatus = normalizeToolStatus(item.status ?? item.state ?? item.result);
  const classification = classifyCommand(raw, { durationMs: item.durationMs ?? options.durationMs });
  const actionCategory = commandActionsCategory(item.commandActions);
  const actionSummary = summarizeCommandActions(item.commandActions, options.maxLength);
  return {
    rawCommand: raw,
    displayCommand,
    ...classification,
    summary: actionSummary || summarizeCommand(raw, options),
    category: actionCategory || classification.category,
    toolName: commandToolName(item),
    environmentLabel: commandEnvironmentLabel(raw, options),
    normalizedStatus,
    rawInput: raw,
    inputPreview: toolInputPreview(item, options),
  };
}
