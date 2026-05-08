import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./server.js";

describe("server entrypoint UX", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("prints help when launched directly in a terminal", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await main([], { isTTY: true } as NodeJS.ReadStream);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("npx -y fit-wiki-mcp@latest"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("fit-wiki-mcp "));
  });

  it("delegates arguments to the auth CLI", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["--help"], { isTTY: true } as NodeJS.ReadStream);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("fit-wiki-mcp auth status"));
  });

  it("prints version from the server entrypoint", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["--version"], { isTTY: true } as NodeJS.ReadStream);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^fit-wiki-mcp \d+\.\d+\.\d+/));
  });
});
