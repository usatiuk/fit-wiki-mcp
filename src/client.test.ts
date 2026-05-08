import { describe, expect, it } from "vitest";
import { FitWikiClient } from "./client.js";
import { StoreAuthProvider, MemoryAuthStore } from "./keychain.js";

describe("FitWikiClient", () => {
  it("uses stored auth cookie on requests", async () => {
    const seenCookies: string[] = [];
    const store = new MemoryAuthStore({
      baseUrl: "https://fit-wiki.cz",
      cookieHeader: "DokuWiki=session; DWabc=auth",
      createdAt: "2026-01-01T00:00:00.000Z",
      cookies: []
    });
    const client = new FitWikiClient({
      baseUrl: "https://fit-wiki.cz",
      authProvider: new StoreAuthProvider(store),
      minDelayMs: 0,
      fetchImpl: async (_input, init) => {
        seenCookies.push(new Headers(init?.headers).get("cookie") ?? "");
        return new Response(searchHtml(), { headers: { "content-type": "text/html" } });
      }
    });

    const results = await client.search("rozvrh");

    expect(seenCookies).toEqual(["DokuWiki=session; DWabc=auth"]);
    expect(results[0]).toMatchObject({
      pageId: "škola:fitfaq",
      title: "FIT FAQ",
      hits: 2
    });
  });

  it("rejects off-origin downloads", async () => {
    const client = new FitWikiClient({ baseUrl: "https://fit-wiki.cz", minDelayMs: 0 });
    await expect(client.getFile({ url: "https://example.com/file.pdf" })).rejects.toThrow("Only https://fit-wiki.cz URLs");
  });

  it("finds files from the XHTML export so hidden page links are included", async () => {
    const requestedUrls: string[] = [];
    const client = new FitWikiClient({
      baseUrl: "https://fit-wiki.cz",
      minDelayMs: 0,
      fetchImpl: async (input) => {
        requestedUrls.push(input.toString());
        return new Response(
          `<div id="dokuwiki__content"><a href="https://fit-wiki.cz/_media/%C5%A1kola/p%C5%99edm%C4%9Bty/dml_31_10_2023_dda1.pdf">31.10.2023 DDα1</a></div>`,
          { headers: { "content-type": "text/html" } }
        );
      }
    });

    const files = await client.findFiles("škola:předměty:bi-dml.21");

    expect(requestedUrls).toEqual(["https://fit-wiki.cz/_export/xhtml/%C5%A1kola/p%C5%99edm%C4%9Bty/bi-dml.21"]);
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pdf",
          title: "31.10.2023 DDα1",
          url: "https://fit-wiki.cz/_media/%C5%A1kola/p%C5%99edm%C4%9Bty/dml_31_10_2023_dda1.pdf"
        })
      ])
    );
  });

  it("reads hidden XHTML export content instead of the rendered shell", async () => {
    const requestedUrls: string[] = [];
    const client = new FitWikiClient({
      baseUrl: "https://fit-wiki.cz",
      minDelayMs: 0,
      fetchImpl: async (input) => {
        requestedUrls.push(input.toString());
        return new Response(
          `<h1>BI-DML.21</h1>
          <div class="hiddenBody">
            <a href="https://fit-wiki.cz/%C5%A1kola/p%C5%99edm%C4%9Bty/bi-dml.21/dml_zapoctovka_1_31-10-2025">31.10.2025 pátek 10:00 Tinková</a>
            <a href="https://fit-wiki.cz/_media/%C5%A1kola/p%C5%99edm%C4%9Bty/dml_31_10_2023_dda1.pdf">31.10.2023 DDα1</a>
          </div>`,
          { headers: { "content-type": "text/html" } }
        );
      }
    });

    const page = await client.readPage("škola:předměty:bi-dml.21");

    expect(requestedUrls).toEqual(["https://fit-wiki.cz/_export/xhtml/%C5%A1kola/p%C5%99edm%C4%9Bty/bi-dml.21"]);
    expect(page.content).toContain("31.10.2025 pátek 10:00 Tinková");
    expect(page.content).toContain("31.10.2023 DDα1");
  });

  it("returns PDFs as bounded binary data", async () => {
    const client = new FitWikiClient({
      baseUrl: "https://fit-wiki.cz",
      maxBinaryBytes: 10,
      minDelayMs: 0,
      fetchImpl: async () =>
        new Response(Buffer.from("%PDF"), {
          headers: { "content-type": "application/pdf", "content-length": "4" }
        })
    });

    const file = await client.exportPdf("škola:fitfaq");
    expect(file.mimeType).toBe("application/pdf");
    expect(file.base64).toBe(Buffer.from("%PDF").toString("base64"));
  });
});

function searchHtml(): string {
  return `
    <div class="search_fulltextresult">
      <dl class="search_results">
        <div class="search_fullpage_result">
          <dt><a href="https://fit-wiki.cz/%C5%A1kola/fitfaq?s[]=rozvrh" class="wikilink1" title="škola:fitfaq" data-wiki-id="škola:fitfaq">FIT FAQ</a> <a>@škola</a></dt>
          <dd class="meta"><small><span class="hits">2 - počet výskytů</span> <time datetime="2017-07-01T15:05:51+00:00"></time></small></dd>
          <dd class="snippet"><strong>Rozvrh</strong> se musí potvrdit.</dd>
        </div>
      </dl>
    </div>`;
}
