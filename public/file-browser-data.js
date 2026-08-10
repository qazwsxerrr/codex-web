const IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

export function normalizeBrowserFilePath(value) {
  const portable = String(value ?? "").replaceAll("\\", "/");
  if (portable.includes("\0") || portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable)) return null;
  const segments = [];
  for (const segment of portable.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

export function browserFileName(filePath) {
  const normalized = String(filePath || "").replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").at(-1) || "Workspace";
}

export function browserParentPath(filePath) {
  const normalized = normalizeBrowserFilePath(filePath);
  if (!normalized) return "";
  return normalized.split("/").slice(0, -1).join("/");
}

export function isBrowserImagePath(filePath) {
  const extension = browserFileName(filePath).toLowerCase().split(".").at(-1);
  return IMAGE_EXTENSIONS.has(extension);
}

export function formatBrowserFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function toggleRightPanelMode(currentMode, requestedMode) {
  if (!['files', 'inspector'].includes(requestedMode)) return "closed";
  return currentMode === requestedMode ? "closed" : requestedMode;
}

export function openBrowserFileTab(tabs, filePath) {
  const path = normalizeBrowserFilePath(filePath);
  if (!path) return { tabs: [...tabs], activePath: null };
  const existing = tabs.find((tab) => tab.path === path);
  if (existing) return { tabs: [...tabs], activePath: path };
  return {
    tabs: [...tabs, { path, label: browserFileName(path) }],
    activePath: path,
  };
}

export function closeBrowserFileTab(tabs, activePath, filePath) {
  const closingIndex = tabs.findIndex((tab) => tab.path === filePath);
  if (closingIndex < 0) return { tabs: [...tabs], activePath };
  const nextTabs = tabs.filter((tab) => tab.path !== filePath);
  if (activePath !== filePath) return { tabs: nextTabs, activePath };
  const nextIndex = Math.min(closingIndex, nextTabs.length - 1);
  return { tabs: nextTabs, activePath: nextIndex >= 0 ? nextTabs[nextIndex].path : null };
}

function stripQueryAndFragment(value) {
  return value.split("#", 1)[0].split("?", 1)[0];
}

function stripLineAndColumnSuffix(value) {
  return value.replace(/:\d+(?::\d+)?$/, "");
}

function normalizedAbsolute(value) {
  const portable = String(value || "").replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(portable) ? portable.toLowerCase() : portable;
}

export function resolveWorkspaceFileHref(href, workspaceCwd) {
  const rawHref = String(href || "").trim();
  if (!rawHref || rawHref.startsWith("#") || /^(?:https?|mailto|data|javascript):/i.test(rawHref)) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(stripQueryAndFragment(rawHref.replace(/^file:\/\//i, "")));
  } catch {
    return null;
  }
  const portable = stripLineAndColumnSuffix(decoded).replaceAll("\\", "/");
  const cwd = String(workspaceCwd || "").replaceAll("\\", "/").replace(/\/+$/, "");
  const absolute = portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable);
  if (absolute) {
    if (!cwd) return null;
    const comparablePath = normalizedAbsolute(portable);
    const comparableCwd = normalizedAbsolute(cwd);
    if (comparablePath === comparableCwd) return "";
    if (!comparablePath.startsWith(`${comparableCwd}/`)) return null;
    return normalizeBrowserFilePath(portable.slice(cwd.length + 1));
  }
  return normalizeBrowserFilePath(portable);
}

export function sourceFileLines(content) {
  const lines = String(content ?? "").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines.length ? lines : [""];
}
