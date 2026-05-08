import { describe, expect, it } from "vitest";
import { getAuthStatus, loginWithPassword } from "./auth.js";
import { MemoryAuthStore } from "./keychain.js";

describe("auth login flow", () => {
  it("captures sticky DokuWiki cookies without storing password", async () => {
    const calls: Request[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push(new Request(input, init));
      if (calls.length === 1) {
        return htmlResponse("<form id='dw__login'></form>", {
          "set-cookie": "DokuWiki=session123; path=/; HttpOnly"
        });
      }
      if (init?.method === "POST") {
        return htmlResponse("<a href='?do=logout'>Odhlásit se</a><a href='?do=profile'>fituser</a>", {
          "set-cookie": "DWabc=Zml0dXNlcg==|1|c2VjcmV0; expires=Wed, 01 Jan 2031 00:00:00 GMT; path=/; HttpOnly"
        });
      }
      return htmlResponse("<a href='?do=logout'>Odhlásit se</a><a href='?do=profile'>fituser</a>", {
        "set-cookie": "DWabc=Zml0dXNlcg==|1|c2VjcmV0; expires=Wed, 01 Jan 2031 00:00:00 GMT; path=/; HttpOnly"
      });
    };

    const result = await loginWithPassword({
      baseUrl: "https://fit-wiki.cz",
      username: "fituser",
      password: "secret",
      fetchImpl
    });

    expect(calls).toHaveLength(3);
    expect(await calls[1].text()).toContain("p=secret");
    expect(result.storedAuth.cookieHeader).toContain("DokuWiki=session123");
    expect(result.storedAuth.cookieHeader).toContain("DWabc=Zml0dXNlcg==|1|c2VjcmV0");
    expect(JSON.stringify(result.storedAuth)).not.toContain("secret");
    expect(result.status.loggedIn).toBe(true);
  });

  it("rejects login when sticky cookie is missing", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!init?.method) return htmlResponse("<form id='dw__login'></form>", { "set-cookie": "DokuWiki=session123" });
      return htmlResponse("<form id='dw__login'></form>");
    };

    await expect(
      loginWithPassword({
        baseUrl: "https://fit-wiki.cz",
        username: "fituser",
        password: "bad",
        fetchImpl
      })
    ).rejects.toThrow("sticky DokuWiki auth cookie");
  });
});

describe("auth status", () => {
  it("reports logged-in pages", async () => {
    const status = await getAuthStatus({
      baseUrl: "https://fit-wiki.cz",
      cookieHeader: "DWabc=value",
      source: "provided",
      fetchImpl: async () => htmlResponse("<a href='?do=logout'>Odhlásit se</a><a href='?do=profile'>fituser</a>")
    });

    expect(status).toMatchObject({ loggedIn: true, username: "fituser" });
  });

  it("reports missing credentials", async () => {
    const status = await getAuthStatus({ source: "none" });
    expect(status.loggedIn).toBe(false);
    expect(status.message).toContain("No FIT Wiki auth cookie");
  });
});

describe("credential store abstraction", () => {
  it("stores and deletes auth records", async () => {
    const store = new MemoryAuthStore();
    await store.set({
      baseUrl: "https://fit-wiki.cz",
      cookieHeader: "DWabc=value",
      createdAt: "2026-01-01T00:00:00.000Z",
      cookies: [{ name: "DWabc", value: "value" }]
    });

    expect((await store.get())?.cookieHeader).toBe("DWabc=value");
    expect(await store.delete()).toBe(true);
    expect(await store.get()).toBeNull();
  });
});

function htmlResponse(body: string, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers
    }
  });
}
