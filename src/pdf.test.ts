import { describe, expect, it } from "vitest";
import { makeTestPdf } from "../test/helpers/pdf-fixture.js";
import { pdfInfo, pdfPageImage, pdfPageText } from "./pdf.js";
import type { DownloadedFile } from "./types.js";

describe("PDF helpers", () => {
  it("returns PDF document info from a PDF buffer", async () => {
    const info = await pdfInfo(pdfFile(["Alpha PDF page one", "Beta PDF page two"]));

    expect(info.totalPages).toBe(2);
    expect(info.metadata.title).toBe("Fit Wiki Test PDF");
    expect(info.metadata.author).toBe("fit-wiki-mcp tests");
    expect(info.metadata.creator).toBe("fixture-generator");
    expect(info.metadata.producer).toBe("fit-wiki-mcp");
  });

  it("extracts text from one PDF page", async () => {
    const page = await pdfPageText(pdfFile(["Alpha PDF page one", "Beta PDF page two"]), 2);

    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.text).toBe("Beta PDF page two");
  });

  it("renders one PDF page as a PNG image", async () => {
    const page = await pdfPageImage(pdfFile(["Alpha PDF page one"]), 1, 1);
    const png = Buffer.from(page.base64, "base64");

    expect(page.mimeType).toBe("image/png");
    expect(page.width).toBeGreaterThan(0);
    expect(page.height).toBeGreaterThan(0);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(1_000);
  });

  it("rejects out-of-range pages", async () => {
    await expect(pdfPageText(pdfFile(["Alpha PDF page one"]), 2)).rejects.toThrow(
      "PDF page 2 is out of range for a 1-page document"
    );
  });

  it("rejects non-PDF files", async () => {
    await expect(
      pdfInfo({
        url: "https://fit-wiki.cz/_media/not-pdf.txt",
        filename: "not-pdf.txt",
        mimeType: "text/plain",
        size: 4,
        base64: Buffer.from("nope").toString("base64")
      })
    ).rejects.toThrow("Expected PDF file, got text/plain");
  });

  it("rejects application/pdf responses without a PDF signature", async () => {
    await expect(
      pdfInfo({
        url: "https://fit-wiki.cz/_media/error.pdf",
        filename: "error.pdf",
        mimeType: "application/pdf",
        size: 22,
        base64: Buffer.from("<html>not a pdf</html>").toString("base64")
      })
    ).rejects.toThrow("Expected PDF file, got application/pdf");
  });
});

function pdfFile(pages: string[], overrides: Partial<DownloadedFile> = {}): DownloadedFile {
  const buffer = makeTestPdf(pages);
  return {
    url: "https://fit-wiki.cz/_media/test.pdf",
    filename: "test.pdf",
    mimeType: "application/pdf",
    size: buffer.byteLength,
    base64: buffer.toString("base64"),
    ...overrides
  };
}
