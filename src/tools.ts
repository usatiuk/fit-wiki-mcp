import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { getAuthStatus } from "./auth.js";
import { DEFAULT_BASE_URL } from "./constants.js";
import { FitWikiClient } from "./client.js";
import { EnvFirstAuthProvider } from "./keychain.js";
import type { AuthStore, DownloadedFile } from "./types.js";

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
      description: "Read a FIT Wiki page by page id or URL as markdown, raw wiki syntax, or clean HTML.",
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
      description: "Find images, PDFs, and downloadable files linked from a FIT Wiki page.",
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
      description: "Download a same-origin FIT Wiki media/file URL or media id. Images return MCP image content; PDFs and other binaries return embedded resources.",
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
      description: "Export a FIT Wiki page as PDF through DokuWiki's export_pdf action.",
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
  const metadata = {
    url: file.url,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size
  };

  if (file.mimeType.startsWith("image/")) {
    return {
      content: [
        { type: "text", text: JSON.stringify(metadata, null, 2) },
        { type: "image", data: file.base64, mimeType: file.mimeType }
      ],
      structuredContent: metadata
    };
  }

  return {
    content: [
      { type: "text", text: JSON.stringify(metadata, null, 2) },
      {
        type: "resource",
        resource: {
          uri: file.url,
          mimeType: file.mimeType,
          blob: file.base64
        }
      }
    ],
    structuredContent: metadata
  };
}
