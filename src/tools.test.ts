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

  it("renders SVG downloads as PNG images and keeps the original SVG resource", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () =>
        new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>`, {
          headers: { "content-type": "image/svg+xml" }
        })
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_get_file",
      arguments: { url: "https://fit-wiki.cz/_media/diagram.svg" }
    });

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({ mimeType: "image/svg+xml" })
        })
      ])
    );
    await client.close();
    await server.close();
  }, 15_000);

  it("returns unsupported image subtypes as resources instead of MCP images", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () => new Response(Buffer.from("BM"), { headers: { "content-type": "image/bmp" } })
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_get_file",
      arguments: { url: "https://fit-wiki.cz/_media/diagram.bmp" }
    });

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({ mimeType: "image/bmp" })
        })
      ])
    );
    expect(result.content.some((item) => item.type === "image")).toBe(false);
    await client.close();
    await server.close();
  });

  it("adds visual inspection guidance for PDF resources", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () => new Response(Buffer.from("%PDF"), { headers: { "content-type": "application/pdf" } })
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_get_file",
      arguments: { url: "https://fit-wiki.cz/_media/exam.pdf" }
    });
    const metadata = JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}") as {
      recommendedNextStep?: string;
      visualInspectionRecommended?: boolean;
      visualInspectionHint?: string;
    };

    expect(metadata.visualInspectionRecommended).toBe(true);
    expect(metadata.recommendedNextStep).toContain("Render/view the PDF pages visually");
    expect(metadata.visualInspectionHint).toContain("Do not rely only on extracted PDF text");
    await client.close();
    await server.close();
  });
});
