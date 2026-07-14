function pathText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(pathText).find(Boolean) || "";
  if (!value || typeof value !== "object") return "";
  for (const key of ["path", "displayPath", "absolutePath", "relativePath", "value"]) {
    const text = pathText(value[key]);
    if (text) return text;
  }
  return "";
}

function kindText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  for (const key of ["kind", "type", "name", "value", "status"]) {
    const text = kindText(value[key]);
    if (text) return text;
  }
  return "";
}

function diffPath(line) {
  const value = line.replace(/^(?:---|\+\+\+)\s+/, "").split("\t")[0];
  if (!value || value === "/dev/null") return "";
  return value.replace(/^[ab]\//, "");
}

const RAW_FILE_KINDS = new Set(["add", "added", "create", "created", "new", "newfile", "delete", "deleted", "remove", "removed"]);

function normalizedKind(kind) {
  return String(kind || "").replace(/[\s_-]/g, "").toLowerCase();
}

function isRawFileKind(kind) {
  return RAW_FILE_KINDS.has(normalizedKind(kind));
}

function parseRawFileContent(source, kind) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const deletion = ["delete", "deleted", "remove", "removed"].includes(normalizedKind(kind));
  const rows = lines.map((text, index) => ({
    index,
    type: deletion ? "deletion" : "addition",
    text: `${deletion ? "-" : "+"}${text}`,
    oldLine: deletion ? index + 1 : null,
    newLine: deletion ? null : index + 1,
  }));
  return {
    rows,
    additions: deletion ? 0 : rows.length,
    deletions: deletion ? rows.length : 0,
    lineCount: rows.length,
  };
}

export function parseUnifiedDiff(source = "") {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  let oldLine = null;
  let newLine = null;
  let additions = 0;
  let deletions = 0;
  const rows = lines.map((text, index) => {
    const hunk = text.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      return { index, type: "hunk", text, oldLine: null, newLine: null };
    }
    if (text.startsWith("\\ No newline at end of file")) {
      return { index, type: "notice", text, oldLine: null, newLine: null };
    }
    if (oldLine !== null && text.startsWith("+") && !text.startsWith("+++")) {
      const row = { index, type: "addition", text, oldLine: null, newLine };
      newLine += 1;
      additions += 1;
      return row;
    }
    if (oldLine !== null && text.startsWith("-") && !text.startsWith("---")) {
      const row = { index, type: "deletion", text, oldLine, newLine: null };
      oldLine += 1;
      deletions += 1;
      return row;
    }
    if (oldLine !== null && text.startsWith(" ")) {
      const row = { index, type: "context", text, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return row;
    }
    return { index, type: "meta", text, oldLine: null, newLine: null };
  });
  return { rows, additions, deletions, lineCount: rows.length };
}

export function diffRowMarker(type) {
  if (type === "addition") return "+";
  if (type === "deletion") return "-";
  if (type === "hunk") return "@";
  return "";
}

function splitTurnDiff(source) {
  const text = String(source || "");
  if (!text.trim()) return [];
  const starts = [...text.matchAll(/^diff --git .+$/gm)].map((match) => match.index);
  if (!starts.length) return [{ diff: text, path: "" }];
  return starts.map((start, index) => {
    const diff = text.slice(start, starts[index + 1] ?? text.length).trimEnd();
    const plus = diff.match(/^\+\+\+\s+(.+)$/m)?.[0] || "";
    const minus = diff.match(/^---\s+(.+)$/m)?.[0] || "";
    const header = diff.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/m);
    return { diff, path: diffPath(plus) || diffPath(minus) || header?.[2] || header?.[1] || "" };
  });
}

export function normalizeFileChanges(value, turnDiff = "") {
  const raw = Array.isArray(value) ? value : value?.changes;
  const changes = Array.isArray(raw) ? raw : [];
  const normalized = changes.map((change, index) => {
    const diff = typeof change?.diff === "string" ? change.diff : "";
    const path = pathText(change?.path) || pathText(change?.file) || `Unknown file ${index + 1}`;
    const kind = kindText(change?.kind) || kindText(change?.type) || "update";
    const parsed = parseUnifiedDiff(diff);
    const parsedAsRawFile = isRawFileKind(kind) && !parsed.rows.some((row) => ["hunk", "addition", "deletion", "context"].includes(row.type));
    return {
      id: `${path}:${index}`,
      path,
      kind,
      diff,
      ...(parsedAsRawFile ? parseRawFileContent(diff, kind) : parsed),
    };
  });
  if (normalized.length) return normalized;
  return splitTurnDiff(turnDiff).map((change, index) => {
    const parsed = parseUnifiedDiff(change.diff);
    return {
      id: `${change.path || "diff"}:${index}`,
      path: change.path || `Diff ${index + 1}`,
      kind: change.diff.includes("new file mode") ? "add" : change.diff.includes("deleted file mode") ? "delete" : "update",
      ...change,
      ...parsed,
    };
  });
}

export function visibleDiffRows(rows, page = 1, pageSize = 400, threshold = 800) {
  if (rows.length <= threshold) return { rows, hasMore: false };
  const end = Math.min(rows.length, Math.max(1, page) * pageSize);
  return { rows: rows.slice(0, end), hasMore: end < rows.length };
}
