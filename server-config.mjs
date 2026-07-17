import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

function nonEmpty(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function configValue(config, ...keys) {
  for (const key of keys) {
    const value = nonEmpty(config?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function resolveConfiguredPath(value, rootDir, { bareCommand = false } = {}) {
  if (!value) return value;
  if (bareCommand && !value.startsWith(".") && !/[\\/]/.test(value)) return value;
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function readConfigFile(configPath) {
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const extension = path.extname(configPath).toLowerCase();
    return {
      exists: true,
      value: extension === ".yaml" || extension === ".yml" ? parseYaml(text) : JSON.parse(text),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: {} };
    throw new Error(`Invalid Codex Web config at ${configPath}: ${error.message}`);
  }
}

export function loadServerConfig({ rootDir = process.cwd(), env = process.env } = {}) {
  const baseDir = path.resolve(rootDir);
  const configuredFile = nonEmpty(env.CODEX_WEB_CONFIG);
  let configPath;
  if (configuredFile) {
    configPath = path.isAbsolute(configuredFile) ? configuredFile : path.resolve(baseDir, configuredFile);
  } else {
    const yamlPath = path.join(baseDir, "config.yaml");
    const ymlPath = path.join(baseDir, "config.yml");
    configPath = fs.existsSync(yamlPath)
      ? yamlPath
      : fs.existsSync(ymlPath)
        ? ymlPath
        : path.join(baseDir, "config.json");
  }
  const loaded = readConfigFile(configPath);
  if (!loaded.value || typeof loaded.value !== "object" || Array.isArray(loaded.value)) {
    throw new Error(`Invalid Codex Web config at ${configPath}: expected a YAML/JSON object`);
  }

  const fileConfig = loaded.value;
  const codexBin = nonEmpty(env.CODEX_BIN)
    || configValue(fileConfig, "codexBin", "codex_bin")
    || "codex";
  const projectCwd = nonEmpty(env.PROJECT_CWD)
    || configValue(fileConfig, "projectCwd", "project_cwd")
    || process.cwd();
  const host = nonEmpty(env.HOST)
    || configValue(fileConfig, "host")
    || "127.0.0.1";
  const portText = nonEmpty(env.PORT)
    || configValue(fileConfig, "port")
    || "4317";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Codex Web port: ${portText}`);
  }

  return {
    configPath,
    configExists: loaded.exists,
    codexBin: resolveConfiguredPath(codexBin, baseDir, { bareCommand: true }),
    projectCwd: resolveConfiguredPath(projectCwd, baseDir),
    host,
    port,
  };
}
