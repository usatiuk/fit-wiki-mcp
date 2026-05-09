import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeTestPdf } from "../test/helpers/pdf-fixture.js";
import { FileCache } from "./cache.js";
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

  it("renders transparent SVG downloads on an opaque white background", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fetchImpl: async () =>
        new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>`, {
          headers: { "content-type": "image/svg+xml" }
        })
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_get_file",
      arguments: { url: "https://fit-wiki.cz/_media/transparent.svg" }
    });
    const image = result.content[0];
    if (image.type !== "image") {
      throw new Error(`Expected image content, got ${image.type}`);
    }

    expect(firstPngPixel(Buffer.from(image.data, "base64"))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
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

  it("returns PDF info, page text, and page images while reusing the file cache", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "fit-wiki-tools-cache-"));
    const pdf = makeTestPdf(["Alpha PDF page one", "Beta PDF page two"]);
    let fetchCount = 0;
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fileCache: new FileCache({ cacheDir, ttlMs: 60_000, maxBytes: 1_000_000 }),
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(pdf, { headers: { "content-type": "application/pdf" } });
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const info = await client.callTool({
        name: "fitwiki_pdf_info",
        arguments: { url: "https://fit-wiki.cz/_media/exam.pdf" }
      });
      expect(info.structuredContent).toMatchObject({ totalPages: 2 });

      const text = await client.callTool({
        name: "fitwiki_pdf_page_text",
        arguments: { url: "https://fit-wiki.cz/_media/exam.pdf", page: 2 }
      });
      expect(text.structuredContent).toMatchObject({ page: 2, totalPages: 2, text: "Beta PDF page two" });

      const image = await client.callTool({
        name: "fitwiki_pdf_page_image",
        arguments: { url: "https://fit-wiki.cz/_media/exam.pdf", page: 1, scale: 1 }
      });
      expect(image.content).toEqual([expect.objectContaining({ type: "image", mimeType: "image/png" })]);
      expect(image.structuredContent).toMatchObject({ page: 1, totalPages: 2, mimeType: "image/png" });
      expect(fetchCount).toBe(1);
    } finally {
      await client.close();
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("passes stored auth into PDF tool fetches", async () => {
    const seenCookies: string[] = [];
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore({
        baseUrl: "https://fit-wiki.cz",
        cookieHeader: "DWabc=auth",
        createdAt: "2026-01-01T00:00:00.000Z",
        cookies: []
      }),
      fileCache: new FileCache({ disabled: true }),
      fetchImpl: async (_input, init) => {
        seenCookies.push(new Headers(init?.headers).get("cookie") ?? "");
        return new Response(makeTestPdf(["Alpha PDF page one"]), { headers: { "content-type": "application/pdf" } });
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fitwiki_pdf_page_text",
      arguments: { url: "https://fit-wiki.cz/_media/exam.pdf", page: 1 }
    });

    expect(result.structuredContent).toMatchObject({ text: "Alpha PDF page one" });
    expect(seenCookies).toEqual(["DWabc=auth"]);
    await client.close();
    await server.close();
  });

  it("returns tool errors for invalid PDF page requests and non-PDF inputs", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    let response = new Response(makeTestPdf(["Alpha PDF page one"]), { headers: { "content-type": "application/pdf" } });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore(),
      fileCache: new FileCache({ disabled: true }),
      fetchImpl: async () => response
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const invalidPage = await client.callTool({
      name: "fitwiki_pdf_page_text",
      arguments: { url: "https://fit-wiki.cz/_media/exam.pdf", page: 2 }
    });
    expect(invalidPage.isError).toBe(true);
    expect(invalidPage.content[0]).toMatchObject({
      type: "text",
      text: "PDF page 2 is out of range for a 1-page document"
    });

    response = new Response("not pdf", { headers: { "content-type": "text/plain" } });
    const nonPdf = await client.callTool({
      name: "fitwiki_pdf_info",
      arguments: { url: "https://fit-wiki.cz/_media/not-pdf.txt" }
    });
    expect(nonPdf.isError).toBe(true);
    expect(nonPdf.content[0]).toMatchObject({ type: "text", text: "Expected PDF file, got text/plain" });
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
    const pdfPageImage = tools.tools.find((tool) => tool.name === "fitwiki_pdf_page_image");

    expect(getFile?.description).toContain("embedded resources with real MIME type and base64 blob");
    expect(getFile?.description).toContain("render/view pages visually");
    expect(pdfPageImage?.description).toContain("Render one page");
    expect(pdfPageImage?.description).toContain("diagrams, scans, formulas, tables");
    await client.close();
    await server.close();
  });
});

function firstPngPixel(png: Buffer): { r: number; g: number; b: number; a: number } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (width < 1 || height < 1 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: ${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const row = Buffer.from(inflated.subarray(1, 1 + stride));
  unfilterPngRow(inflated[0] ?? 0, row, Buffer.alloc(stride), channels);

  return {
    r: row[0] ?? 0,
    g: row[1] ?? 0,
    b: row[2] ?? 0,
    a: channels === 4 ? (row[3] ?? 0) : 255
  };
}

function unfilterPngRow(filter: number, row: Buffer, previous: Buffer, channels: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? (row[index - channels] ?? 0) : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= channels ? (previous[index - channels] ?? 0) : 0;
    if (filter === 1) {
      row[index] = ((row[index] ?? 0) + left) & 0xff;
    } else if (filter === 2) {
      row[index] = ((row[index] ?? 0) + up) & 0xff;
    } else if (filter === 3) {
      row[index] = ((row[index] ?? 0) + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = ((row[index] ?? 0) + paeth(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter: ${filter}`);
    }
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? up : upLeft;
}
