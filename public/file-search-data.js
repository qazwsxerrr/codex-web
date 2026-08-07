export function normalizeFileSearchFiles(source) {
  const files = Array.isArray(source) ? source : source?.files;
  if (!Array.isArray(files)) return [];

  const seen = new Set();
  return files.filter((file) => {
    const path = String(file?.path || "").trim();
    if (file?.match_type !== "file" || !path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}
