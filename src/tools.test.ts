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

  it("renders SVG downloads as PNG image content only", async () => {
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

    expect(result.content).toEqual([expect.objectContaining({ type: "image", mimeType: "image/png" })]);
    await client.close();
    await server.close();
  }, 15_000);

  it("returns raster image downloads as image content only", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () => new Response(Buffer.from("fake png"), { headers: { "content-type": "image/png" } })
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_get_file",
      arguments: { url: "https://fit-wiki.cz/_media/diagram.png" }
    });

    expect(result.content).toEqual([expect.objectContaining({ type: "image", mimeType: "image/png" })]);
    await client.close();
    await server.close();
  });

  it("returns unsupported image subtypes as real resource blobs instead of MCP images", async () => {
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
          resource: expect.objectContaining({ mimeType: "image/bmp", blob: Buffer.from("BM").toString("base64") })
        })
      ])
    );
    expect(result.content.some((item) => item.type === "image")).toBe(false);
    await client.close();
    await server.close();
  });

  it("returns PDF downloads as real resource blobs", async () => {
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

    expect(result.content).toEqual([
      expect.objectContaining({
        type: "resource",
        resource: expect.objectContaining({ mimeType: "application/pdf", blob: Buffer.from("%PDF").toString("base64") })
      })
    ]);
    await client.close();
    await server.close();
  });

  it("describes PDF visual inspection in the file tool guidance", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () => new Response("ok")
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const getFile = tools.tools.find((tool) => tool.name === "fitwiki_get_file");

    expect(getFile?.description).toContain("embedded resources with real MIME type and base64 blob");
    expect(getFile?.description).toContain("render/view pages visually");
    await client.close();
    await server.close();
  });
});
