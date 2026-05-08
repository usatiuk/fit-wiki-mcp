import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { load } from "cheerio";
import { beforeAll, describe, expect, it } from "vitest";
import { getAuthStatus, loginWithPassword } from "../src/auth.js";
import { FitWikiClient } from "../src/client.js";
import { MemoryAuthStore } from "../src/keychain.js";
import { registerFitWikiTools } from "../src/tools.js";

const BASE_URL = process.env.FITWIKI_TEST_BASE_URL ?? "https://fit-wiki.cz";
const DML_PAGE = "škola:předměty:bi-dml.21";
const DML_2025_TERM_PAGE = "škola:předměty:bi-dml.21:dml_zapoctovka_1_31-10-2025";
const DML_2025_TERM_LINK_TEXT = "31.10.2025 pátek 10:00 Tinková";
const DML_2025_FORMULA_PROMPT =
  "Následující formuli upravte do ÚDNT/ÚKNT, napište, jestli se jedná o ÚDNT nebo ÚKNT, a určete pro kolik ohodnocení formule platí.";
const DML_2023_PDF_LINK_TEXT = "31.10.2023 DDα1";
const DML_2023_PDF_FILENAME = "dml_31_10_2023_dda1.pdf";
const SPI_MARKOV_SVG_URL =
  "https://fit-wiki.cz/_media/%C5%A1kola/p%C5%99edm%C4%9Bty/mi-spi/zkouska_19_6_2023_diagram.svg";

describe("FIT Wiki public live smoke", () => {
  it("can read the public registration page", async () => {
    const client = new FitWikiClient({ baseUrl: BASE_URL, minDelayMs: 0 });
    const html = await client.text(new URL("/obsah?do=register", BASE_URL));

    expect(html).toContain('id="dw__register"');
    expect(html).toContain("Pro registraci");
    expect(html).toContain("Uživatelské jméno");
  });

  it("can download a public FIT Wiki image", async () => {
    const client = new FitWikiClient({ baseUrl: BASE_URL, minDelayMs: 0 });
    const image = await client.getFile({ url: new URL("/lib/tpl/bootstrap3/images/logo.png", BASE_URL).toString() });

    expect(image.filename).toBe("logo.png");
    expect(image.mimeType).toBe("image/png");
    expect(image.size).toBeGreaterThan(1_000);
    expect(image.base64.length).toBeGreaterThan(1_000);
  });
});

const hasAuthEnv = Boolean(
  process.env.FITWIKI_COOKIE || (process.env.FITWIKI_TEST_USERNAME && process.env.FITWIKI_TEST_PASSWORD)
);
const describeAuth = hasAuthEnv ? describe : describe.skip;

describeAuth("FIT Wiki authenticated live regression", () => {
  let cookieHeader = "";
  let client: FitWikiClient;

  beforeAll(async () => {
    cookieHeader = process.env.FITWIKI_COOKIE ?? "";

    if (!cookieHeader) {
      const login = await loginWithPassword({
        baseUrl: BASE_URL,
        username: requiredEnv("FITWIKI_TEST_USERNAME"),
        password: requiredEnv("FITWIKI_TEST_PASSWORD")
      });
      cookieHeader = login.storedAuth.cookieHeader;
    }

    client = new FitWikiClient({
      baseUrl: BASE_URL,
      authProvider: { getCookieHeader: async () => cookieHeader },
      minDelayMs: 0
    });
  });

  it("logs in and reports authenticated status", async () => {
    const status = await getAuthStatus({ baseUrl: BASE_URL, cookieHeader, source: "provided" });

    expect(status.loggedIn).toBe(true);
    expect(status.username).toBeTruthy();
    expect(status.message).toBe("Logged in to FIT Wiki");
  });

  it("finds and reads DML course content with expected exam-term links", async () => {
    const results = await client.search("BI-DML", 10);
    expect(results.some((result) => result.pageId === DML_PAGE)).toBe(true);

    const page = await client.readPage(DML_PAGE, "markdown");
    expect(page.title).toContain("BI-DML.21");
    expect(page.content).toContain(DML_2025_TERM_LINK_TEXT);
    expect(page.content).toContain("dml_zapoctovka_1_31-10-2025");
    expect(page.content).toContain(DML_2023_PDF_LINK_TEXT);
    expect(page.content).toContain(DML_2023_PDF_FILENAME);
  });

  it("reads the 2025 DML term page and downloads its formula image plus page PDF", async () => {
    const page = await client.readPage(DML_2025_TERM_PAGE, "markdown");
    expect(page.content).toContain(DML_2025_FORMULA_PROMPT);

    const files = await client.findFiles(DML_2025_TERM_PAGE);
    const image = files.find((file) => file.kind === "image" && file.url.includes("media=latex%3A"));
    expect(image).toBeDefined();

    const imageDownload = await client.getFile({ url: image?.url });
    expect(imageDownload.mimeType).toBe("image/gif");
    expect(imageDownload.size).toBeGreaterThan(100);

    const pdf = await client.exportPdf(DML_2025_TERM_PAGE);
    expect(pdf.filename).toBe("škola_předměty_bi-dml.21_dml_zapoctovka_1_31-10-2025.pdf");
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(1_000);
  });

  it("discovers and downloads the 2023 DML DDα1 PDF from the course page", async () => {
    const page = await client.readPage(DML_PAGE, "html");
    const href = findLinkHref(page.content, DML_2023_PDF_LINK_TEXT);
    expect(href).toContain(DML_2023_PDF_FILENAME);

    const files = await client.findFiles(DML_PAGE);
    expect(files.some((file) => file.kind === "pdf" && file.url.includes(DML_2023_PDF_FILENAME))).toBe(true);

    const pdf = await client.getFile({ url: href });
    expect(pdf.filename).toBe(DML_2023_PDF_FILENAME);
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(100_000);
  });

  it("renders an authenticated MI-SPI SVG diagram as a supported MCP PNG image", async () => {
    const server = new McpServer({ name: "live-test", version: "0.0.0" });
    registerFitWikiTools(server, {
      store: new MemoryAuthStore({
        baseUrl: BASE_URL,
        cookieHeader,
        createdAt: new Date().toISOString(),
        cookies: []
      }),
      baseUrl: BASE_URL
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "live-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const result = await mcpClient.callTool({
      name: "fitwiki_get_file",
      arguments: { url: SPI_MARKOV_SVG_URL }
    });
    const content = result.content as Array<{ type?: string; mimeType?: string; resource?: { mimeType?: string } }>;

    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({ mimeType: "image/svg+xml" })
        })
      ])
    );

    await mcpClient.close();
    await server.close();
  });
});

function findLinkHref(html: string, text: string): string {
  const $ = load(html);
  const link = $("a[href]")
    .toArray()
    .find((element) => $(element).text().replace(/\s+/g, " ").trim() === text);
  const href = link ? $(link).attr("href") : undefined;
  if (!href) throw new Error(`Expected link not found: ${text}`);
  return href;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
