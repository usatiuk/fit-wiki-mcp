import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DownloadedFile } from "./types.js";

export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_CACHE_MAX_BYTES = 50 * 1024 * 1024;

type CacheEntryMetadata = Omit<DownloadedFile, "base64"> & {
  key: string;
  createdAt: number;
  accessedAt: number;
};

type CacheEntryPaths = {
  dir: string;
  data: string;
  metadata: string;
};

export type FileCacheOptions = {
  cacheDir?: string;
  ttlMs?: number;
  maxBytes?: number;
  disabled?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

export class FileCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly disabled: boolean;
  private readonly now: () => number;
  private readonly pending = new Map<string, Promise<DownloadedFile>>();

  constructor(options: FileCacheOptions = {}) {
    const env = options.env ?? process.env;
    this.cacheDir = options.cacheDir ?? env.FITWIKI_CACHE_DIR ?? join(tmpdir(), "fit-wiki-mcp-cache");
    this.ttlMs = options.ttlMs ?? parseNonNegativeInteger(env.FITWIKI_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
    this.maxBytes = options.maxBytes ?? parseNonNegativeInteger(env.FITWIKI_CACHE_MAX_BYTES, DEFAULT_CACHE_MAX_BYTES);
    this.disabled = options.disabled ?? (env.FITWIKI_CACHE_DISABLED === "1" || env.FITWIKI_CACHE_DISABLED === "true");
    this.now = options.now ?? Date.now;
  }

  async getOrLoad(keyParts: unknown[], load: () => Promise<DownloadedFile>): Promise<DownloadedFile> {
    if (this.disabled) return load();

    const key = cacheKey(keyParts);
    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = this.getOrLoadCached(key, load).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async getOrLoadCached(key: string, load: () => Promise<DownloadedFile>): Promise<DownloadedFile> {
    let cacheReady = true;
    try {
      await this.ensureCacheDir();
    } catch {
      cacheReady = false;
    }

    if (!cacheReady) return load();

    const cached = await this.read(key);
    if (cached) return cached;

    const loaded = await load();
    try {
      await this.write(key, loaded);
      await this.cleanup();
    } catch {
      // Cache failures should not break a successful download.
    }
    return loaded;
  }

  private entryPaths(key: string): CacheEntryPaths {
    const dir = join(this.cacheDir, key.slice(0, 2));
    return {
      dir,
      data: join(dir, `${key}.bin`),
      metadata: join(dir, `${key}.json`)
    };
  }

  private async ensureCacheDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
  }

  private async read(key: string): Promise<DownloadedFile | null> {
    const paths = this.entryPaths(key);
    try {
      const [metadataRaw, data] = await Promise.all([readFile(paths.metadata, "utf8"), readFile(paths.data)]);
      const metadata = JSON.parse(metadataRaw) as CacheEntryMetadata;
      if (metadata.key !== key || metadata.createdAt + this.ttlMs <= this.now()) {
        await this.remove(key);
        return null;
      }

      metadata.accessedAt = this.now();
      void this.writeMetadata(paths, metadata).catch(() => {});
      return {
        url: metadata.url,
        filename: metadata.filename,
        mimeType: metadata.mimeType,
        size: metadata.size,
        base64: data.toString("base64")
      };
    } catch {
      return null;
    }
  }

  private async write(key: string, file: DownloadedFile): Promise<void> {
    const paths = this.entryPaths(key);
    const now = this.now();
    await mkdir(paths.dir, { recursive: true, mode: 0o700 });
    const metadata: CacheEntryMetadata = {
      key,
      url: file.url,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: now,
      accessedAt: now
    };
    await this.writeFileAtomic(paths.data, Buffer.from(file.base64, "base64"));
    await this.writeMetadata(paths, metadata);
  }

  private async writeMetadata(paths: CacheEntryPaths, metadata: CacheEntryMetadata): Promise<void> {
    await this.writeFileAtomic(paths.metadata, JSON.stringify(metadata));
  }

  private async writeFileAtomic(path: string, content: Buffer | string): Promise<void> {
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, content, { mode: 0o600 });
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async cleanup(): Promise<void> {
    const entries = await this.entries();
    const now = this.now();
    const live: CacheEntryMetadata[] = [];

    for (const entry of entries) {
      if (entry.createdAt + this.ttlMs <= now) {
        await this.remove(entry.key);
      } else {
        live.push(entry);
      }
    }

    let totalBytes = live.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of live.sort((left, right) => left.accessedAt - right.accessedAt)) {
      if (totalBytes <= this.maxBytes) break;
      await this.remove(entry.key);
      totalBytes -= entry.size;
    }
  }

  private async entries(): Promise<CacheEntryMetadata[]> {
    try {
      const shardNames = await readdir(this.cacheDir);
      const entries: CacheEntryMetadata[] = [];
      for (const shardName of shardNames) {
        const shardPath = join(this.cacheDir, shardName);
        if (!(await isDirectory(shardPath))) continue;
        for (const filename of await readdir(shardPath)) {
          if (!filename.endsWith(".json")) continue;
          try {
            entries.push(JSON.parse(await readFile(join(shardPath, filename), "utf8")) as CacheEntryMetadata);
          } catch {
            // Corrupt metadata should not break tool calls.
          }
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  private async remove(key: string): Promise<void> {
    const paths = this.entryPaths(key);
    await Promise.all([rm(paths.data, { force: true }), rm(paths.metadata, { force: true })]);
  }
}

export function cacheKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function authCacheNamespace(source: string, cookieHeader?: string): string {
  return `${source}:${cacheKey([cookieHeader ?? ""])}`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
