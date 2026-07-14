import { unwrapConfig } from "./status-data.js";

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function normalizeMcpInventory(result, configResult, startupStatuses = {}) {
  const config = unwrapConfig(configResult);
  const configured = config.mcp_servers || config.mcpServers || {};
  const servers = Array.isArray(result?.data) ? result.data : [];
  return servers.map((server) => {
    const serverConfig = configured[server.name] || {};
    const startup = startupStatuses[server.name] || {};
    return {
      name: server.name,
      enabled: serverConfig.enabled ?? (serverConfig.disabled !== undefined ? !serverConfig.disabled : null),
      transport: serverConfig.url ? "http" : serverConfig.command ? "stdio" : null,
      url: serverConfig.url || null,
      command: serverConfig.command || null,
      args: Array.isArray(serverConfig.args) ? serverConfig.args : [],
      cwd: serverConfig.cwd || null,
      envNames: Object.keys(serverConfig.env || {}).sort(),
      bearerTokenEnvVar: serverConfig.bearer_token_env_var || serverConfig.bearerTokenEnvVar || null,
      startupTimeoutSec: serverConfig.startup_timeout_sec ?? serverConfig.startupTimeoutSec ?? null,
      toolTimeoutSec: serverConfig.tool_timeout_sec ?? serverConfig.toolTimeoutSec ?? null,
      status: startup.status || null,
      error: startup.error || startup.failureReason || null,
      authStatus: server.authStatus,
      serverInfo: server.serverInfo || null,
      tools: values(server.tools),
      resources: values(server.resources),
      resourceTemplates: values(server.resourceTemplates),
    };
  });
}

export function formatMcpInventory(result, configResult, startupStatuses = {}, verbose = false) {
  const servers = normalizeMcpInventory(result, configResult, startupStatuses);
  if (!servers.length) return "No configured MCP servers were returned.";
  return servers.map((server) => {
    const info = server.serverInfo;
    const title = info?.title || info?.name;
    const lines = [server.name];
    if (title || info?.version) {
      lines.push(`  Server: ${title || server.name}${info?.version ? ` v${info.version}` : ""}`);
    }
    lines.push(`  Enabled: ${server.enabled === null ? "not reported" : server.enabled ? "yes" : "no"}${server.transport ? ` · transport: ${server.transport}` : ""}`);
    if (server.url) lines.push(`  URL: ${server.url}`);
    if (server.command) lines.push(`  Command: ${[server.command, ...server.args].join(" ")}`);
    if (server.cwd) lines.push(`  Cwd: ${server.cwd}`);
    if (server.bearerTokenEnvVar) lines.push(`  Bearer token env: ${server.bearerTokenEnvVar}`);
    if (server.status) lines.push(`  Startup: ${server.status}${server.error ? ` · ${server.error}` : ""}`);
    lines.push(`  Authentication: ${authLabel(server.authStatus)}`);
    lines.push(`  Tools (${server.tools.length})${server.tools.length ? `: ${server.tools.map((tool) => tool.name).join(", ")}` : ""}`);
    lines.push(`  Resources: ${server.resources.length} · templates: ${server.resourceTemplates.length}`);
    if (info?.description) lines.push(`  ${info.description}`);
    if (info?.websiteUrl) lines.push(`  Website: ${info.websiteUrl}`);
    if (verbose && server.envNames.length) lines.push(`  Environment keys: ${server.envNames.join(", ")}`);
    if (verbose && (server.startupTimeoutSec !== null || server.toolTimeoutSec !== null)) {
      lines.push(`  Timeouts: startup ${server.startupTimeoutSec ?? "default"}s · tool ${server.toolTimeoutSec ?? "default"}s`);
    }
    if (verbose && server.tools.length) {
      lines.push("  Tool details:");
      for (const tool of server.tools) {
        lines.push(`    - ${tool.name}${tool.description ? `: ${tool.description}` : ""}`);
      }
    }
    if (verbose && server.resources.length) {
      lines.push("  Resources:");
      for (const resource of server.resources) {
        lines.push(`    - ${resource.name}: ${resource.uri}`);
      }
    }
    if (verbose && server.resourceTemplates.length) {
      lines.push("  Resource templates:");
      for (const template of server.resourceTemplates) {
        lines.push(`    - ${template.name}: ${template.uriTemplate}`);
      }
    }
    return lines.join("\n");
  }).join("\n\n");
}

function authLabel(status) {
  switch (status) {
    case "bearerToken": return "Bearer token configured";
    case "oAuth": return "OAuth connected";
    case "notLoggedIn": return "Not logged in";
    case "unsupported": return "Not supported";
    default: return status || "Not reported";
  }
}
