import { DEFAULT_BASE_URL } from "./constants.js";

export function makeBaseUrl(value = DEFAULT_BASE_URL): URL {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function assertSameOriginUrl(input: string, baseUrl = DEFAULT_BASE_URL): URL {
  const base = makeBaseUrl(baseUrl);
  const url = new URL(input, base);
  if (url.origin !== base.origin) {
    throw new Error(`Only ${base.origin} URLs are allowed`);
  }
  return url;
}

export function pageIdToPath(pageId: string): string {
  return pageId
    .split(":")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function pageIdToUrl(pageId: string, baseUrl = DEFAULT_BASE_URL): string {
  return new URL(`/${pageIdToPath(pageId)}`, makeBaseUrl(baseUrl)).toString();
}

export function pageIdToExportUrl(pageId: string, format: "raw" | "xhtml", baseUrl = DEFAULT_BASE_URL): string {
  return new URL(`/_export/${format}/${pageIdToPath(pageId)}`, makeBaseUrl(baseUrl)).toString();
}

export function pageIdToPdfUrl(pageId: string, baseUrl = DEFAULT_BASE_URL): string {
  const url = new URL(`/${pageIdToPath(pageId)}`, makeBaseUrl(baseUrl));
  url.searchParams.set("do", "export_pdf");
  return url.toString();
}

export function normalizePageId(input: string, baseUrl = DEFAULT_BASE_URL): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Page id or URL is required");

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    const url = assertSameOriginUrl(trimmed, baseUrl);
    const id = url.searchParams.get("id");
    if (id) return sanitizePageId(id);

    const pathname = decodeURIComponent(url.pathname)
      .replace(/^\/+/, "")
      .replace(/^_export\/(?:raw|xhtml)\//, "");
    return sanitizePageId(pathname.replace(/\//g, ":"));
  }

  return sanitizePageId(trimmed);
}

export function sanitizePageId(pageId: string): string {
  return decodeURIComponent(pageId)
    .trim()
    .replace(/^:+|:+$/g, "")
    .replace(/\//g, ":")
    .replace(/\s+/g, "_");
}

export function filenameFromUrl(url: string, fallback = "download"): string {
  const parsed = new URL(url);
  const disposition = parsed.searchParams.get("media") || parsed.pathname.split("/").pop() || fallback;
  const decoded = decodeURIComponent(disposition);
  const name = decoded.split(/[/:]/).pop() || fallback;
  return name.replace(/[^\w.\-() ]+/g, "_");
}

export function extensionFromUrl(url: string): string | undefined {
  const pathname = new URL(url).pathname.toLowerCase();
  const match = pathname.match(/\.([a-z0-9]+)$/);
  return match?.[1];
}

