import TurndownService from "turndown";
import {
  DEFAULT_BASE_URL,
  DEFAULT_LICENSE,
  DEFAULT_LICENSE_URL,
  DEFAULT_MAX_BINARY_BYTES,
  DEFAULT_USER_AGENT
} from "./constants.js";
import {
  parseFileEntries,
  pageTitleFromHtml,
  parseIndexEntries,
  parseSearchResults
} from "./parsers.js";
import type {
  AuthProvider,
  DownloadedFile,
  FetchLike,
  FileEntry,
  IndexEntry,
  PageReadFormat,
  PageReadResult,
  SearchResult
} from "./types.js";
import {
  assertSameOriginUrl,
  filenameFromUrl,
  makeBaseUrl,
  normalizePageId,
  pageIdToExportUrl,
  pageIdToPdfUrl,
  pageIdToUrl
} from "./url.js";

export type FitWikiClientOptions = {
  baseUrl?: string;
  authProvider?: AuthProvider;
  fetchImpl?: FetchLike;
  maxBinaryBytes?: number;
  minDelayMs?: number;
};

export class FitWikiClient {
  readonly baseUrl: string;
  private readonly authProvider?: AuthProvider;
  private readonly fetchImpl: FetchLike;
  private readonly maxBinaryBytes: number;
  private readonly minDelayMs: number;
  private lastRequestAt = 0;
  private readonly turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

  constructor(options: FitWikiClientOptions = {}) {
    this.baseUrl = makeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL).toString();
    this.authProvider = options.authProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBinaryBytes = options.maxBinaryBytes ?? DEFAULT_MAX_BINARY_BYTES;
    this.minDelayMs = options.minDelayMs ?? 250;
  }

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const url = new URL("/doku.php", this.baseUrl);
    url.searchParams.set("do", "search");
    url.searchParams.set("id", "obsah");
    url.searchParams.set("q", query);
    url.searchParams.set("sf", "1");
    const html = await this.text(url);
    return parseSearchResults(html, this.baseUrl, limit);
  }

  async suggestions(query: string): Promise<string[]> {
    const url = new URL("/lib/exe/ajax.php", this.baseUrl);
    url.searchParams.set("call", "suggestions");
    url.searchParams.set("q", query);
    const response = await this.fetchWiki(url);
    const payload = (await response.json()) as [string, string[], unknown[], unknown[]];
    return payload[1] ?? [];
  }

  async listIndex(namespace?: string): Promise<IndexEntry[]> {
    const url = new URL("/obsah", this.baseUrl);
    url.searchParams.set("do", "index");
    if (namespace) url.searchParams.set("idx", namespace);
    const html = await this.text(url);
    return parseIndexEntries(html, this.baseUrl);
  }

  async readPage(input: string, format: PageReadFormat = "markdown"): Promise<PageReadResult> {
    const pageId = normalizePageId(input, this.baseUrl);
    if (format === "raw") {
      const url = pageIdToExportUrl(pageId, "raw", this.baseUrl);
      return {
        pageId,
        url: pageIdToUrl(pageId, this.baseUrl),
        format,
        content: await this.text(url),
        license: DEFAULT_LICENSE,
        licenseUrl: DEFAULT_LICENSE_URL
      };
    }

    const exportUrl = pageIdToExportUrl(pageId, "xhtml", this.baseUrl);
    const html = await this.text(exportUrl);
    return {
      pageId,
      url: pageIdToUrl(pageId, this.baseUrl),
      format,
      title: pageTitleFromHtml(html),
      content: format === "html" ? html : this.turndown.turndown(html),
      license: DEFAULT_LICENSE,
      licenseUrl: DEFAULT_LICENSE_URL
    };
  }

  async findFiles(input: string): Promise<FileEntry[]> {
    const pageId = normalizePageId(input, this.baseUrl);
    const html = await this.text(pageIdToUrl(pageId, this.baseUrl));
    const entries = parseFileEntries(html, this.baseUrl);
    entries.push({
      kind: "pdf",
      url: pageIdToPdfUrl(pageId, this.baseUrl),
      title: `${pageId} PDF export`,
      extension: "pdf",
      source: "href"
    });
    return entries;
  }

  async getFile(input: { url?: string; mediaId?: string }): Promise<DownloadedFile> {
    const url = input.mediaId
      ? this.mediaUrl(input.mediaId)
      : input.url
        ? assertSameOriginUrl(input.url, this.baseUrl)
        : undefined;
    if (!url) throw new Error("url or mediaId is required");
    return this.download(url);
  }

  async exportPdf(input: string): Promise<DownloadedFile> {
    const pageId = normalizePageId(input, this.baseUrl);
    return this.download(pageIdToPdfUrl(pageId, this.baseUrl), `${pageId.replace(/:/g, "_")}.pdf`);
  }

  async text(input: string | URL): Promise<string> {
    const response = await this.fetchWiki(input);
    if (!response.ok) throw new Error(`FIT Wiki request failed: ${response.status} ${response.statusText}`);
    return response.text();
  }

  async fetchWiki(input: string | URL, init: RequestInit = {}): Promise<Response> {
    await this.throttle();
    const url = assertSameOriginUrl(input.toString(), this.baseUrl);
    const cookieHeader = await this.authProvider?.getCookieHeader();
    const headers = new Headers(init.headers);
    headers.set("User-Agent", DEFAULT_USER_AGENT);
    if (cookieHeader && !headers.has("Cookie")) headers.set("Cookie", cookieHeader);
    this.lastRequestAt = Date.now();
    return this.fetchImpl(url, { ...init, headers });
  }

  private async download(input: string | URL, filename?: string): Promise<DownloadedFile> {
    const url = assertSameOriginUrl(input.toString(), this.baseUrl);
    const response = await this.fetchWiki(url);
    if (!response.ok) throw new Error(`FIT Wiki file request failed: ${response.status} ${response.statusText}`);

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > this.maxBinaryBytes) {
      throw new Error(`File is ${contentLength} bytes; max allowed is ${this.maxBinaryBytes}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > this.maxBinaryBytes) {
      throw new Error(`File is ${buffer.byteLength} bytes; max allowed is ${this.maxBinaryBytes}`);
    }

    return {
      url: url.toString(),
      filename: filename ?? filenameFromUrl(url.toString()),
      mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
      size: buffer.byteLength,
      base64: buffer.toString("base64")
    };
  }

  private mediaUrl(mediaId: string): URL {
    const url = new URL("/lib/exe/fetch.php", this.baseUrl);
    url.searchParams.set("media", mediaId);
    return url;
  }

  private async throttle(): Promise<void> {
    if (!this.minDelayMs) return;
    const waitMs = this.lastRequestAt + this.minDelayMs - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

