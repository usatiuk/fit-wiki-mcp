#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KeychainAuthStore } from "./keychain.js";
import { registerFitWikiTools } from "./tools.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "fit-wiki-mcp",
    version: "0.1.0"
  });

  registerFitWikiTools(server, {
    store: new KeychainAuthStore(),
    baseUrl: process.env.FITWIKI_BASE_URL
  });

  return server;
}

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

