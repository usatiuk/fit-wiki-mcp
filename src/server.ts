#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { main as cliMain } from "./cli.js";
import { isEntrypoint } from "./entrypoint.js";
import { KeychainAuthStore } from "./keychain.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-info.js";
import { registerFitWikiTools } from "./tools.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  registerFitWikiTools(server, {
    store: new KeychainAuthStore(),
    baseUrl: process.env.FITWIKI_BASE_URL
  });

  return server;
}

export async function main(
  argv = process.argv.slice(2),
  stdin: Pick<NodeJS.ReadStream, "isTTY"> = process.stdin
): Promise<void> {
  if (isVersionArg(argv)) {
    console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
    return;
  }

  if (argv.length > 0) {
    await cliMain(argv);
    return;
  }

  if (stdin.isTTY) {
    printHelp();
    return;
  }

  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

function isVersionArg(argv: string[]): boolean {
  return argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version");
}

function printHelp(): void {
  console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}

fit-wiki-mcp is an MCP stdio server.

Use it from an MCP client with:
  npx -y fit-wiki-mcp@latest

Login helper:
  npx -y fit-wiki-mcp@latest auth login --username USER

Auth status:
  npx -y fit-wiki-mcp@latest auth status

Version:
  npx -y fit-wiki-mcp@latest --version`);
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
