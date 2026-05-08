import { load } from "cheerio";
import type { FileEntry, IndexEntry, SearchResult } from "./types.js";
import { assertSameOriginUrl, extensionFromUrl, normalizePageId } from "./url.js";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
const FILE_EXTENSIONS = ["zip", "txt", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json", "xml", "tar", "gz"];

export function parseSearchResults(html: string, baseUrl: string, limit: number): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];

  $(".search_quickhits li").each((_, item) => {
    const link = $(item).find("a.wikilink1").first();
    const href = link.attr("href");
    if (!href || results.length >= limit) return;
    const url = assertSameOriginUrl(href, baseUrl).toString();
    const pageId = link.attr("data-wiki-id") || link.attr("title") || normalizePageId(url, baseUrl);
    results.push({
      title: normalizeWhitespace(link.text()),
      pageId,
      url,
      namespace: namespaceOf(pageId)
    });
  });

  $(".search_fullpage_result").each((_, item) => {
    if (results.length >= limit) return;
    const container = $(item);
    const link = container.find("dt a.wikilink1").first();
    const href = link.attr("href");
    if (!href) return;
    const url = assertSameOriginUrl(href, baseUrl);
    url.search = "";
    const pageId = link.attr("data-wiki-id") || link.attr("title") || normalizePageId(url.toString(), baseUrl);
    const hitsText = container.find(".hits").text();
    const hits = Number(hitsText.match(/\d+/)?.[0] ?? "");
    const namespaceText = container.find("dt a").last().text().replace(/^@/, "").trim();
    results.push({
      title: normalizeWhitespace(link.text()),
      pageId,
      url: url.toString(),
      namespace: namespaceText || namespaceOf(pageId),
      hits: Number.isFinite(hits) ? hits : undefined,
      lastModified: container.find("time[datetime]").attr("datetime"),
      snippet: normalizeWhitespace(container.find(".snippet").text())
    });
  });

  return dedupeBy(results, (result) => result.pageId).slice(0, limit);
}

export function parseIndexEntries(html: string, baseUrl: string): IndexEntry[] {
  const $ = load(html);
  const entries: IndexEntry[] = [];

  $("#index__tree a").each((_, item) => {
    const link = $(item);
    const href = link.attr("href");
    if (!href) return;
    const url = assertSameOriginUrl(href, baseUrl).toString();
    const title = normalizeWhitespace(link.text());
    if (!title) return;

    if (link.hasClass("idx_dir")) {
      const parsed = new URL(url);
      const namespace = parsed.searchParams.get("idx") || title;
      entries.push({ type: "namespace", title, namespace, url });
      return;
    }

    const pageId = link.attr("data-wiki-id") || link.attr("title") || normalizePageId(url, baseUrl);
    entries.push({ type: "page", title, pageId, namespace: namespaceOf(pageId), url });
  });

  return dedupeBy(entries, (entry) => `${entry.type}:${entry.pageId ?? entry.namespace ?? entry.url}`);
}

export function parseFileEntries(html: string, baseUrl: string): FileEntry[] {
  const $ = load(html);
  const entries: FileEntry[] = [];
  const root = $("#dokuwiki__content").length ? $("#dokuwiki__content") : $("body");

  root.find("img[src]").each((_, item) => {
    const src = $(item).attr("src");
    if (!src) return;
    const entry = fileEntryFromUrl(src, baseUrl, "img", $(item).attr("alt"));
    if (entry) entries.push(entry);
  });

  root.find("a[href]").each((_, item) => {
    const href = $(item).attr("href");
    if (!href) return;
    const entry = fileEntryFromUrl(href, baseUrl, "href", normalizeWhitespace($(item).text()));
    if (entry) entries.push(entry);
  });

  return dedupeBy(entries, (entry) => entry.url);
}

export function pageTitleFromHtml(html: string): string | undefined {
  const $ = load(html);
  return normalizeWhitespace($("h1").first().text() || $("title").text()) || undefined;
}

export function authStateFromHtml(html: string): { loggedIn: boolean; username?: string } {
  const $ = load(html);
  const hasLoginForm = $("#dw__login").length > 0 || $("input[name='do'][value='login']").length > 0;
  const logoutLink = $("a[href*='do=logout']").first();
  const userText =
    normalizeWhitespace($("#dw__user_menu .dropdown-toggle .hidden-lg").first().text()) ||
    normalizeWhitespace($("#dw__user_menu img[alt]").first().attr("alt") ?? "") ||
    normalizeWhitespace($(".user").first().text()) ||
    normalizeWhitespace($("a[href*='do=profile']").first().text()) ||
    undefined;

  return {
    loggedIn: !hasLoginForm && logoutLink.length > 0,
    username: userText
  };
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fileEntryFromUrl(
  input: string,
  baseUrl: string,
  source: "img" | "href",
  title?: string
): FileEntry | null {
  if (input.startsWith("#") || input.startsWith("mailto:") || input.startsWith("javascript:")) return null;
  let url: URL;
  try {
    url = assertSameOriginUrl(input, baseUrl);
  } catch {
    return null;
  }

  const pathname = url.pathname;
  if (pathname.includes("/lib/exe/css.php") || pathname.includes("/lib/exe/js.php")) return null;
  if (pathname.includes("/lib/exe/taskrunner.php")) return null;
  if (pathname.includes("/lib/tpl/") && !pathname.includes("/images/logo")) return null;

  const media = url.searchParams.get("media");
  const extension = extensionFromPathLike(media ?? "") ?? extensionFromUrl(url.toString());
  const kind = fileKindFromExtension(extension, source, url.searchParams.get("do") === "export_pdf");

  if (kind === "link") return null;

  return {
    kind,
    url: url.toString(),
    title: title || undefined,
    extension,
    source
  };
}

function extensionFromPathLike(value: string): string | undefined {
  const match = value.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return match?.[1];
}

function fileKindFromExtension(
  extension: string | undefined,
  source: "img" | "href",
  isPdfExport: boolean
): FileEntry["kind"] {
  if (isPdfExport || extension === "pdf") return "pdf";
  if (source === "img" || IMAGE_EXTENSIONS.includes(extension ?? "")) return "image";
  if (FILE_EXTENSIONS.includes(extension ?? "")) return "file";
  return "link";
}

function namespaceOf(pageId: string): string | undefined {
  const parts = pageId.split(":");
  parts.pop();
  return parts.length ? parts.join(":") : undefined;
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
