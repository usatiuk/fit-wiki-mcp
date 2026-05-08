import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntrypoint } from "./entrypoint.js";

describe("isEntrypoint", () => {
  it("matches npm bin symlinks to the real module path", () => {
    const dir = mkdtempSync(join(tmpdir(), "fit-wiki-entrypoint-"));
    const target = join(dir, "cli.js");
    const link = join(dir, "fit-wiki-mcp");

    writeFileSync(target, "#!/usr/bin/env node\n");
    symlinkSync(target, link);

    expect(isEntrypoint(pathToFileURL(realpathSync(target)).href, link)).toBe(true);
  });
});
