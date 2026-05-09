import path from "node:path";
import { createRequire } from "node:module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DEFAULT_MAX_BINARY_BYTES } from "./constants.js";
import type { DownloadedFile } from "./types.js";

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
};

type PdfPageLike = {
  cleanup(): void;
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
    background?: string;
  }): { promise: Promise<void> };
};

type PdfCanvasAndContext = {
  canvas: { toBuffer(format: "image/png"): Buffer };
  context: unknown;
};

type PdfPageRef = {
  num: number;
  gen: number;
};

type PdfOutlineNodeLike = {
  title?: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: PdfOutlineNodeLike[];
};

type PdfMetadataResultLike = {
  info?: Record<string, unknown>;
};

type PdfDocumentLike = {
  canvasFactory: {
    create(width: number, height: number): PdfCanvasAndContext;
    destroy(canvasAndContext: PdfCanvasAndContext): void;
  };
  numPages: number;
  destroy(): Promise<void>;
  getDestination(destinationId: string): Promise<unknown[] | null>;
  getMetadata(): Promise<PdfMetadataResultLike>;
  getOutline(): Promise<PdfOutlineNodeLike[] | null>;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getPageIndex(pageRef: PdfPageRef): Promise<number>;
  getPageLabels(): Promise<string[] | null>;
};

export type PdfOutlineItem = {
  title: string;
  pageNumber: number | null;
  url: string | null;
  children: PdfOutlineItem[];
};

export type PdfDocumentInfo = {
  url: string;
  filename: string;
  size: number;
  totalPages: number;
  pageLabels: string[] | null;
  outline: PdfOutlineItem[];
  metadata: {
    title: string | null;
    author: string | null;
    subject: string | null;
    keywords: string | null;
    creator: string | null;
    producer: string | null;
    creationDate: string | null;
    modificationDate: string | null;
  };
};

export type PdfPageText = {
  url: string;
  filename: string;
  page: number;
  totalPages: number;
  text: string;
};

export type PdfPageImage = {
  url: string;
  filename: string;
  page: number;
  totalPages: number;
  width: number;
  height: number;
  mimeType: "image/png";
  base64: string;
};

const require = createRequire(import.meta.url);
const pdfjsDistDirectory = path.dirname(require.resolve("pdfjs-dist/package.json"));
const cMapUrl = path.join(pdfjsDistDirectory, "cmaps", path.sep);
const standardFontDataUrl = path.join(pdfjsDistDirectory, "standard_fonts", path.sep);
const MAX_RENDER_PIXELS = 20_000_000;

export function assertPdfFile(file: DownloadedFile): void {
  const signature = Buffer.from(file.base64.slice(0, 32), "base64").subarray(0, 4).toString("ascii");
  if (signature !== "%PDF") {
    throw new Error(`Expected PDF file, got ${file.mimeType}`);
  }
}

export async function pdfInfo(file: DownloadedFile): Promise<PdfDocumentInfo> {
  assertPdfFile(file);
  return withPdfDocument(file, async (document) => {
    const [pageLabels, outlineNodes, metadataResult] = await Promise.all([
      document.getPageLabels(),
      document.getOutline(),
      document.getMetadata()
    ]);
    const info = metadataResult.info ?? {};

    return {
      url: file.url,
      filename: file.filename,
      size: file.size,
      totalPages: document.numPages,
      pageLabels: Array.isArray(pageLabels) && pageLabels.every((label) => typeof label === "string") ? pageLabels : null,
      outline: await mapPdfOutlineItems(document, outlineNodes),
      metadata: {
        title: nullableString(info.Title),
        author: nullableString(info.Author),
        subject: nullableString(info.Subject),
        keywords: nullableString(info.Keywords),
        creator: nullableString(info.Creator),
        producer: nullableString(info.Producer),
        creationDate: nullableString(info.CreationDate),
        modificationDate: nullableString(info.ModDate)
      }
    };
  });
}

export async function pdfPageText(file: DownloadedFile, page: number): Promise<PdfPageText> {
  assertPdfFile(file);
  return withPdfDocument(file, async (document) => {
    assertPageInRange(document, page);
    const pdfPage = await document.getPage(page);
    try {
      return {
        url: file.url,
        filename: file.filename,
        page,
        totalPages: document.numPages,
        text: await extractPageText(pdfPage)
      };
    } finally {
      pdfPage.cleanup();
    }
  });
}

export async function pdfPageImage(file: DownloadedFile, page: number, scale = 1.5): Promise<PdfPageImage> {
  assertPdfFile(file);
  return withPdfDocument(file, async (document) => {
    assertPageInRange(document, page);
    const pdfPage = await document.getPage(page);
    try {
      const viewport = pdfPage.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      if (width * height > MAX_RENDER_PIXELS) {
        throw new Error(`Rendered PDF page is ${width}x${height}; max allowed is ${MAX_RENDER_PIXELS} pixels`);
      }

      const canvasAndContext = document.canvasFactory.create(width, height);
      try {
        await pdfPage.render({ canvasContext: canvasAndContext.context, viewport, background: "rgb(255,255,255)" }).promise;
        const png = canvasAndContext.canvas.toBuffer("image/png");
        if (png.byteLength > DEFAULT_MAX_BINARY_BYTES) {
          throw new Error(`Rendered PDF page is ${png.byteLength} bytes; max allowed is ${DEFAULT_MAX_BINARY_BYTES}`);
        }
        return {
          url: file.url,
          filename: file.filename,
          page,
          totalPages: document.numPages,
          width,
          height,
          mimeType: "image/png",
          base64: png.toString("base64")
        };
      } finally {
        document.canvasFactory.destroy(canvasAndContext);
      }
    } finally {
      pdfPage.cleanup();
    }
  });
}

async function withPdfDocument<TResult>(file: DownloadedFile, work: (document: PdfDocumentLike) => Promise<TResult>): Promise<TResult> {
  const document = (await getDocument({
    data: new Uint8Array(Buffer.from(file.base64, "base64")),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl
  }).promise) as unknown as PdfDocumentLike;

  try {
    return await work(document);
  } finally {
    await document.destroy();
  }
}

async function extractPageText(page: PdfPageLike): Promise<string> {
  const textContent = await page.getTextContent();
  let text = "";
  for (const item of textContent.items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function mapPdfOutlineItems(document: PdfDocumentLike, items: PdfOutlineNodeLike[] | null): Promise<PdfOutlineItem[]> {
  if (!items) return [];
  const outline: PdfOutlineItem[] = [];
  for (const item of items) {
    outline.push({
      title: typeof item.title === "string" ? item.title : "",
      pageNumber: await resolveOutlinePageNumber(document, item.dest),
      url: nullableString(item.url),
      children: await mapPdfOutlineItems(document, item.items ?? null)
    });
  }
  return outline;
}

async function resolveOutlinePageNumber(document: PdfDocumentLike, destination: string | unknown[] | null | undefined): Promise<number | null> {
  let resolvedDestination: unknown = destination ?? null;
  if (typeof resolvedDestination === "string") {
    resolvedDestination = await document.getDestination(resolvedDestination);
  }
  if (!Array.isArray(resolvedDestination)) return null;
  const pageRef = resolvedDestination[0];
  return isPdfPageRef(pageRef) ? (await document.getPageIndex(pageRef)) + 1 : null;
}

function assertPageInRange(document: PdfDocumentLike, page: number): void {
  if (page < 1 || page > document.numPages) {
    throw new Error(`PDF page ${page} is out of range for a ${document.numPages}-page document`);
  }
}

function isPdfPageRef(value: unknown): value is PdfPageRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "num" in value &&
    typeof value.num === "number" &&
    Number.isInteger(value.num) &&
    value.num > 0 &&
    "gen" in value &&
    typeof value.gen === "number" &&
    Number.isInteger(value.gen) &&
    value.gen >= 0
  );
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
