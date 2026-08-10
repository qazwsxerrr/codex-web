import fs from "node:fs/promises";
import path from "node:path";

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DIRECTORY_ENTRIES = 2_000;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".cache",
  ".turbo",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonl: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "css",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
}));

export class FileAccessError extends Error {
  constructor(message, { code = "FILE_ACCESS_ERROR", status = 400 } = {}) {
    super(message);
    this.name = "FileAccessError";
    this.code = code;
    this.status = status;
  }
}

function accessError(message, code, status) {
  return new FileAccessError(message, { code, status });
}

export function normalizeRelativeFilePath(value) {
  const raw = String(value ?? "");
  if (raw.includes("\0")) throw accessError("File path contains an invalid character", "INVALID_PATH", 400);

  const portable = raw.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable) || portable.startsWith("//")) {
    throw accessError("Only workspace-relative file paths are allowed", "ABSOLUTE_PATH", 400);
  }

  const segments = [];
  for (const segment of portable.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw accessError("File path cannot leave the workspace", "PATH_TRAVERSAL", 403);
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalWorkspaceRoot(root) {
  const requested = String(root || "").trim();
  if (!requested) throw accessError("No workspace is available", "WORKSPACE_UNAVAILABLE", 409);
  try {
    const canonical = await fs.realpath(requested);
    const stats = await fs.stat(canonical);
    if (!stats.isDirectory()) throw accessError("Workspace root is not a directory", "INVALID_WORKSPACE", 400);
    return canonical;
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    if (error?.code === "ENOENT") throw accessError("Workspace root was not found", "WORKSPACE_NOT_FOUND", 404);
    throw error;
  }
}

export async function resolveWorkspacePath(root, relativePath = "") {
  const canonicalRoot = await canonicalWorkspaceRoot(root);
  const normalizedPath = normalizeRelativeFilePath(relativePath);
  const candidate = path.resolve(canonicalRoot, ...normalizedPath.split("/").filter(Boolean));
  if (!isWithinRoot(canonicalRoot, candidate)) {
    throw accessError("File path cannot leave the workspace", "PATH_TRAVERSAL", 403);
  }

  let canonicalTarget;
  try {
    canonicalTarget = await fs.realpath(candidate);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw accessError("File or directory was not found", "FILE_NOT_FOUND", 404);
    }
    throw error;
  }
  if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
    throw accessError("Symbolic link leaves the workspace", "SYMLINK_ESCAPE", 403);
  }
  return { canonicalRoot, canonicalTarget, normalizedPath };
}

function relativeChildPath(parent, name) {
  return [parent, name].filter(Boolean).join("/");
}

async function directoryEntry(root, parent, dirent) {
  const relativePath = relativeChildPath(parent, dirent.name);
  if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) return null;

  try {
    const { canonicalTarget } = await resolveWorkspacePath(root, relativePath);
    const stats = await fs.stat(canonicalTarget);
    if (stats.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) return null;
    return {
      name: dirent.name,
      path: relativePath,
      isDirectory: stats.isDirectory(),
      size: stats.isFile() ? stats.size : 0,
      modified: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (error instanceof FileAccessError && (dirent.isSymbolicLink() || error.code === "FILE_NOT_FOUND")) return null;
    throw error;
  }
}

export async function listWorkspaceDirectory(root, relativePath = "") {
  const resolved = await resolveWorkspacePath(root, relativePath);
  const stats = await fs.stat(resolved.canonicalTarget);
  if (!stats.isDirectory()) throw accessError("Path is not a directory", "NOT_A_DIRECTORY", 400);

  const dirents = await fs.readdir(resolved.canonicalTarget, { withFileTypes: true });
  const entries = (await Promise.all(dirents.map((dirent) => directoryEntry(
    resolved.canonicalRoot,
    resolved.normalizedPath,
    dirent,
  )))).filter(Boolean);
  entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });

  return {
    path: resolved.normalizedPath,
    entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated: entries.length > MAX_DIRECTORY_ENTRIES,
  };
}

export function languageForFile(filePath) {
  const name = path.basename(String(filePath || "")).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "makefile";
  if (name === ".env" || name.startsWith(".env.")) return "bash";
  return LANGUAGE_BY_EXTENSION.get(path.extname(name).slice(1)) || "text";
}

export async function readWorkspaceText(root, relativePath) {
  const resolved = await resolveWorkspacePath(root, relativePath);
  const stats = await fs.stat(resolved.canonicalTarget);
  if (!stats.isFile()) throw accessError("Path is not a file", "NOT_A_FILE", 400);
  if (stats.size > MAX_TEXT_FILE_BYTES) {
    throw accessError("Text file is larger than 2 MiB", "FILE_TOO_LARGE", 413);
  }

  const buffer = await fs.readFile(resolved.canonicalTarget);
  if (buffer.subarray(0, 8_192).includes(0)) {
    throw accessError("Binary files cannot be shown as text", "UNSUPPORTED_FILE", 415);
  }

  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw accessError("File is not valid UTF-8 text", "UNSUPPORTED_FILE", 415);
  }

  return {
    path: resolved.normalizedPath,
    content,
    language: languageForFile(resolved.normalizedPath),
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

export function imageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function readWorkspaceImage(root, relativePath) {
  const resolved = await resolveWorkspacePath(root, relativePath);
  const stats = await fs.stat(resolved.canonicalTarget);
  if (!stats.isFile()) throw accessError("Path is not a file", "NOT_A_FILE", 400);
  if (stats.size > MAX_IMAGE_FILE_BYTES) {
    throw accessError("Image is larger than 10 MiB", "FILE_TOO_LARGE", 413);
  }

  const content = await fs.readFile(resolved.canonicalTarget);
  const mime = imageMime(content);
  if (!mime) throw accessError("Unsupported image format", "UNSUPPORTED_FILE", 415);
  return {
    path: resolved.normalizedPath,
    content,
    mime,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}
