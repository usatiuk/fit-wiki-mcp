import { DEFAULT_BASE_URL, DEFAULT_USER_AGENT } from "./constants.js";
import { CookieJar, getSetCookieHeaders, stickyCookieExpires } from "./cookies.js";
import { authStateFromHtml } from "./parsers.js";
import type { AuthStatus, FetchLike, LoginResult, StoredAuth } from "./types.js";
import { assertSameOriginUrl, makeBaseUrl } from "./url.js";

export type LoginOptions = {
  baseUrl?: string;
  username: string;
  password: string;
  fetchImpl?: FetchLike;
};

export async function loginWithPassword(options: LoginOptions): Promise<LoginResult> {
  const baseUrl = makeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL).toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const jar = new CookieJar();

  const seedUrl = new URL("/obsah", baseUrl);
  const seedResponse = await fetchImpl(seedUrl, {
    headers: { "User-Agent": DEFAULT_USER_AGENT }
  });
  jar.addFromSetCookie(getSetCookieHeaders(seedResponse.headers));

  const body = new URLSearchParams({
    sectok: "",
    id: "obsah",
    do: "login",
    u: options.username,
    p: options.password,
    r: "1"
  });

  const loginResponse = await fetchImpl(seedUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": DEFAULT_USER_AGENT,
      Cookie: jar.toHeader()
    },
    body
  });
  jar.addFromSetCookie(getSetCookieHeaders(loginResponse.headers));

  let statusUrl = seedUrl;
  if (isRedirect(loginResponse.status)) {
    const location = loginResponse.headers.get("location");
    if (location) statusUrl = assertSameOriginUrl(location, baseUrl);
  }

  const cookieHeader = jar.toHeader(/^(DokuWiki|DW)/i);
  const authCookie = jar.findAuthCookie();
  if (!authCookie || authCookie.value.split("|")[1] !== "1") {
    throw new Error("Login failed: FIT Wiki did not return sticky DokuWiki auth cookie");
  }

  const status = await getAuthStatus({
    baseUrl,
    cookieHeader,
    source: "provided",
    fetchImpl,
    statusPath: statusUrl.pathname + statusUrl.search
  });
  if (!status.loggedIn) {
    throw new Error(`Login failed: ${status.message}`);
  }

  const storedAuth: StoredAuth = {
    baseUrl,
    username: status.username || options.username,
    cookieHeader,
    createdAt: new Date().toISOString(),
    expiresAt: stickyCookieExpires(authCookie),
    cookies: jar.toJSON().filter((cookie) => /^(DokuWiki|DW)/i.test(cookie.name))
  };

  return { storedAuth, status: { ...status, expiresAt: storedAuth.expiresAt } };
}

export type AuthStatusOptions = {
  baseUrl?: string;
  cookieHeader?: string;
  source: AuthStatus["source"];
  fetchImpl?: FetchLike;
  statusPath?: string;
};

export async function getAuthStatus(options: AuthStatusOptions): Promise<AuthStatus> {
  if (!options.cookieHeader) {
    return {
      loggedIn: false,
      source: options.source,
      message: "No FIT Wiki auth cookie found"
    };
  }

  const baseUrl = makeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL).toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const statusUrl = new URL(options.statusPath ?? "/obsah", baseUrl);
  const response = await fetchImpl(statusUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Cookie: options.cookieHeader
    }
  });
  const html = await response.text();
  const state = authStateFromHtml(html);
  return {
    loggedIn: state.loggedIn,
    source: options.source,
    username: state.username,
    message: state.loggedIn ? "Logged in to FIT Wiki" : "FIT Wiki returned login form"
  };
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

