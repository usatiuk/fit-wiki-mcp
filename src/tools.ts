import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Resvg } from "@resvg/resvg-js";
import * as z from "zod/v4";
import { getAuthStatus } from "./auth.js";
import { DEFAULT_BASE_URL, DEFAULT_MAX_BINARY_BYTES } from "./constants.js";
import { FitWikiClient } from "./client.js";
import { EnvFirstAuthProvider } from "./keychain.js";
import type { AuthStore, DownloadedFile } from "./types.js";

const MCP_RASTER_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const SVG_RENDER_OPTIONS = { background: "white" };

export type RegisterToolsOptions = {
  store: AuthStore;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

export function registerFitWikiTools(server: McpServer, options: RegisterToolsOptions): void {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const authProvider = new EnvFirstAuthProvider(options.store, options.env);
  const client = new FitWikiClient({
    baseUrl,
    authProvider,
    fetchImpl: options.fetchImpl
  });

  server.registerTool(
    "fitwiki_search",
    {
      title: "Search FIT Wiki",
      description: "Live-search FIT Wiki pages with DokuWiki search.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).default(10)
      }
    },
    async ({ query, limit }) => jsonResult(await client.search(query, limit))
  );

  server.registerTool(
    "fitwiki_read_page",
    {
      title: "Read FIT Wiki Page",
      description:
        "Read a FIT Wiki page by page id or URL as markdown, raw wiki syntax, or clean HTML. For diagrams, scans, or visual PDF content, use the file/PDF tools too; text extraction can miss embedded figures.",
      inputSchema: {
        page: z.string().min(1),
        format: z.enum(["markdown", "raw", "html"]).default("markdown")
      }
    },
    async ({ page, format }) => jsonTextResult(await client.readPage(page, format))
  );

  server.registerTool(
    "fitwiki_list_index",
    {
      title: "List FIT Wiki Index",
      description: "List visible FIT Wiki pages and namespaces from the DokuWiki index tree.",
      inputSchema: {
        namespace: z.string().optional()
      }
    },
    async ({ namespace }) => jsonResult(await client.listIndex(namespace))
  );

  server.registerTool(
    "fitwiki_find_files",
    {
      title: "Find FIT Wiki Files",
      description:
        "Find images, PDFs, and downloadable files linked from a FIT Wiki page. Use before get_file when answers depend on diagrams, scans, or attachments rather than page text alone.",
      inputSchema: {
        page: z.string().min(1)
      }
    },
    async ({ page }) => jsonResult(await client.findFiles(page))
  );

  server.registerTool(
    "fitwiki_get_file",
    {
      title: "Get FIT Wiki File",
      description:
        "Download a same-origin FIT Wiki media/file URL or media id. Raster images return MCP image content; SVGs return rendered PNG image content; PDFs and other binaries return embedded resources with real MIME type and base64 blob. For PDFs, render/view pages visually in the client before answering questions that depend on diagrams, scans, formulas, tables, or layout.",
      inputSchema: {
        url: z.string().optional(),
        mediaId: z.string().optional()
      }
    },
    async ({ url, mediaId }) => fileResult(await client.getFile({ url, mediaId }))
  );

  server.registerTool(
    "fitwiki_export_pdf",
    {
      title: "Export FIT Wiki Page PDF",
      description:
        "Export a FIT Wiki page as PDF through DokuWiki's export_pdf action. Useful when visual layout, formulas, diagrams, or embedded images matter more than text-only page extraction.",
      inputSchema: {
        page: z.string().min(1)
      }
    },
    async ({ page }) => fileResult(await client.exportPdf(page))
  );

  server.registerTool(
    "fitwiki_auth_check",
    {
      title: "Check FIT Wiki Auth",
      description: "Check whether the configured FIT Wiki cookie logs in successfully.",
      inputSchema: {}
    },
    async () => {
      const source = await authProvider.source();
      const cookieHeader = await authProvider.getCookieHeader();
      return jsonResult(await getAuthStatus({ baseUrl, cookieHeader, source, fetchImpl: options.fetchImpl }));
    }
  );
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: Array.isArray(value) ? { results: value } : (value as Record<string, unknown>)
  };
}

function jsonTextResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}

function fileResult(file: DownloadedFile): CallToolResult {
  if (MCP_RASTER_IMAGE_MIME_TYPES.has(file.mimeType)) {
    return {
      content: [{ type: "image", data: file.base64, mimeType: file.mimeType }]
    };
  }

  if (isSvgFile(file)) {
    return svgResult(file);
  }

  return {
    content: [resourceBlobContent(file)]
  };
}

function svgResult(file: DownloadedFile): CallToolResult {
  try {
    const svg = Buffer.from(file.base64, "base64");
    const png = new Resvg(svg, SVG_RENDER_OPTIONS).render().asPng();
    if (png.byteLength > DEFAULT_MAX_BINARY_BYTES) {
      throw new Error(`Rendered PNG is ${png.byteLength} bytes; max allowed is ${DEFAULT_MAX_BINARY_BYTES}`);
    }
    return {
      content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `SVG rasterization failed for ${file.url}: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      isError: true
    };
  }
}

function isSvgFile(file: DownloadedFile): boolean {
  return file.mimeType === "image/svg+xml" || file.filename.toLowerCase().endsWith(".svg");
}

function resourceBlobContent(file: DownloadedFile) {
  return {
    type: "resource" as const,
    resource: {
      uri: file.url,
      mimeType: file.mimeType,
      blob: file.base64
    }
  };
}
