import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { MemoryAuthStore } from "./keychain.js";
import { registerFitWikiTools } from "./tools.js";

describe("MCP tools", () => {
  it("lists tools and passes stored auth into tool fetches", async () => {
    const seenCookies: string[] = [];
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore({
        baseUrl: "https://fit-wiki.cz",
        cookieHeader: "DWabc=auth",
        createdAt: "2026-01-01T00:00:00.000Z",
        cookies: []
      }),
      fetchImpl: async (_input, init) => {
        seenCookies.push(new Headers(init?.headers).get("cookie") ?? "");
        return new Response(`<form id="dw__login"></form>`, { headers: { "content-type": "text/html" } });
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("fitwiki_auth_check");

    const result = await client.callTool({ name: "fitwiki_auth_check", arguments: {} });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(seenCookies).toEqual(["DWabc=auth"]);
    await client.close();
    await server.close();
  });
});

