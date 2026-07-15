import assert from "node:assert/strict";
import test from "node:test";
import { formatMcpInventory, normalizeMcpInventory } from "../public/mcp-data.js";

const inventory = {
  data: [{
    name: "markmap",
    serverInfo: { name: "Markmap MCP Server", version: "0.1.0" },
    tools: {
      markdown_to_mindmap: {
        name: "markdown_to_mindmap",
        description: "Convert Markdown into a mind map",
        inputSchema: { type: "object" },
      },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "unsupported",
  }],
};

const config = {
  config: {
    mcp_servers: {
      markmap: {
        enabled: true,
        command: "npx",
        args: ["-y", "@jinzcdev/markmap-mcp-server"],
        env: { MARKMAP_DIR: "/private/path" },
        startup_timeout_sec: 20,
      },
    },
  },
};

test("reads object-shaped MCP tools and config status", () => {
  const [server] = normalizeMcpInventory(inventory, config, { markmap: { status: "ready" } });
  assert.equal(server.enabled, true);
  assert.equal(server.transport, "stdio");
  assert.deepEqual(server.args, ["-y", "@jinzcdev/markmap-mcp-server"]);
  assert.deepEqual(server.envNames, ["MARKMAP_DIR"]);
  assert.equal(server.status, "ready");
  assert.equal(server.tools.length, 1);
  assert.equal(server.tools[0].name, "markdown_to_mindmap");
});

test("formats real MCP metadata without invented unknown fields", () => {
  const output = formatMcpInventory(inventory, config, {}, true);
  assert.match(output, /Server: Markmap MCP Server v0\.1\.0/);
  assert.match(output, /Enabled: yes · transport: stdio/);
  assert.match(output, /Command: npx -y @jinzcdev\/markmap-mcp-server/);
  assert.match(output, /Environment keys: MARKMAP_DIR/);
  assert.doesNotMatch(output, /private\/path/);
  assert.match(output, /Tools \(1\): markdown_to_mindmap/);
  assert.match(output, /Convert Markdown into a mind map/);
  assert.doesNotMatch(output, /unknown/);
});
