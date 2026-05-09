import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheKey, FileCache } from "./cache.js";
import type { DownloadedFile } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("FileCache", () => {
  it("returns cached files without calling the loader again", async () => {
    const cache = new FileCache({ cacheDir: await tempDir(), ttlMs: 60_000, maxBytes: 1_000_000 });
    let calls = 0;

    const first = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "first");
    });
    const second = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "second");
    });

    expect(calls).toBe(1);
    expect(first.base64).toBe(second.base64);
    expect(Buffer.from(second.base64, "base64").toString()).toBe("first");
  });

  it("deduplicates concurrent loads for the same key", async () => {
    const cacheDir = await tempDir();
    const cache = new FileCache({ cacheDir, ttlMs: 60_000, maxBytes: 1_000_000 });
    const keyParts = ["pdf", "https://fit-wiki.cz/a.pdf", "auth"];
    let calls = 0;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        cache.getOrLoad(keyParts, async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return file("https://fit-wiki.cz/a.pdf", "shared");
        })
      )
    );

    expect(calls).toBe(1);
    expect(results.every((result) => Buffer.from(result.base64, "base64").toString() === "shared")).toBe(true);

    const key = cacheKey(keyParts);
    const metadata = JSON.parse(await readFile(join(cacheDir, key.slice(0, 2), `${key}.json`), "utf8")) as { key: string };
    expect(metadata.key).toBe(key);

    const secondCache = new FileCache({ cacheDir, ttlMs: 60_000, maxBytes: 1_000_000 });
    const cached = await secondCache.getOrLoad(keyParts, async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "miss");
    });
    expect(calls).toBe(1);
    expect(Buffer.from(cached.base64, "base64").toString()).toBe("shared");
  });

  it("does not collide when URLs have the same filename", async () => {
    const leftKey = cacheKey(["pdf", "https://fit-wiki.cz/a/same.pdf", "auth"]);
    const rightKey = cacheKey(["pdf", "https://fit-wiki.cz/b/same.pdf", "auth"]);
    const cache = new FileCache({ cacheDir: await tempDir(), ttlMs: 60_000, maxBytes: 1_000_000 });

    const left = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a/same.pdf", "auth"], async () =>
      file("https://fit-wiki.cz/a/same.pdf", "left")
    );
    const right = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/b/same.pdf", "auth"], async () =>
      file("https://fit-wiki.cz/b/same.pdf", "right")
    );

    expect(leftKey).not.toBe(rightKey);
    expect(Buffer.from(left.base64, "base64").toString()).toBe("left");
    expect(Buffer.from(right.base64, "base64").toString()).toBe("right");
  });

  it("expires entries by TTL", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = new FileCache({ cacheDir: await tempDir(), ttlMs: 10, maxBytes: 1_000_000, now: () => now });

    await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "first");
    });
    now = 1_011;
    const second = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "second");
    });

    expect(calls).toBe(2);
    expect(Buffer.from(second.base64, "base64").toString()).toBe("second");
  });

  it("evicts oldest entries when over the size cap", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = new FileCache({ cacheDir: await tempDir(), ttlMs: 60_000, maxBytes: 6, now: () => now });

    await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "aaaa");
    });
    now += 1;
    await cache.getOrLoad(["pdf", "https://fit-wiki.cz/b.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/b.pdf", "bbbb");
    });
    now += 1;
    const reloaded = await cache.getOrLoad(["pdf", "https://fit-wiki.cz/a.pdf", "auth"], async () => {
      calls += 1;
      return file("https://fit-wiki.cz/a.pdf", "cccc");
    });

    expect(calls).toBe(3);
    expect(Buffer.from(reloaded.base64, "base64").toString()).toBe("cccc");
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fit-wiki-cache-test-"));
  tempDirs.push(dir);
  return dir;
}

function file(url: string, text: string): DownloadedFile {
  const buffer = Buffer.from(text);
  return {
    url,
    filename: "same.pdf",
    mimeType: "application/pdf",
    size: buffer.byteLength,
    base64: buffer.toString("base64")
  };
}
