import type { StoredCookie } from "./types.js";

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  constructor(cookies: StoredCookie[] = []) {
    for (const cookie of cookies) {
      this.set(cookie);
    }
  }

  set(cookie: StoredCookie): void {
    if (!cookie.name) return;
    if (cookie.expires && Date.parse(cookie.expires) <= Date.now()) {
      this.cookies.delete(cookie.name);
      return;
    }
    if (cookie.maxAge !== undefined && cookie.maxAge <= 0) {
      this.cookies.delete(cookie.name);
      return;
    }
    if (cookie.value.toLowerCase() === "deleted") {
      this.cookies.delete(cookie.name);
      return;
    }
    this.cookies.set(cookie.name, cookie);
  }

  addFromSetCookie(headers: string[]): void {
    for (const header of headers) {
      const parsed = parseSetCookie(header);
      if (parsed) this.set(parsed);
    }
  }

  toHeader(names?: RegExp): string {
    return Array.from(this.cookies.values())
      .filter((cookie) => !names || names.test(cookie.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  toJSON(): StoredCookie[] {
    return Array.from(this.cookies.values());
  }

  get(name: string): StoredCookie | undefined {
    return this.cookies.get(name);
  }

  findAuthCookie(): StoredCookie | undefined {
    return Array.from(this.cookies.values()).find((cookie) => /^DW/i.test(cookie.name));
  }
}

export function parseSetCookie(header: string): StoredCookie | null {
  const parts = header.split(";").map((part) => part.trim());
  const [nameValue, ...attributes] = parts;
  const equalsIndex = nameValue.indexOf("=");
  if (equalsIndex <= 0) return null;

  const cookie: StoredCookie = {
    name: nameValue.slice(0, equalsIndex),
    value: nameValue.slice(equalsIndex + 1)
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split("=");
    const key = rawKey.toLowerCase();
    const value = rawValue.join("=");
    if (key === "expires") cookie.expires = value;
    else if (key === "max-age") cookie.maxAge = Number(value);
    else if (key === "path") cookie.path = value;
    else if (key === "domain") cookie.domain = value;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite") cookie.sameSite = value;
  }

  return cookie;
}

export function splitSetCookieHeader(header: string | null): string[] {
  if (!header) return [];
  const result: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let i = 0; i < header.length; i += 1) {
    const segment = header.slice(Math.max(0, i - 8), i + 1).toLowerCase();
    if (segment.endsWith("expires=")) inExpires = true;
    if (inExpires && header[i] === ";") inExpires = false;
    if (!inExpires && header[i] === "," && /\s*\w+=/.test(header.slice(i + 1, i + 40))) {
      result.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(header.slice(start).trim());
  return result.filter(Boolean);
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) return values;
  return splitSetCookieHeader(headers.get("set-cookie"));
}

export function parseCookieHeader(cookieHeader: string): StoredCookie[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const equalsIndex = part.indexOf("=");
      if (equalsIndex <= 0) return null;
      return {
        name: part.slice(0, equalsIndex),
        value: part.slice(equalsIndex + 1)
      } satisfies StoredCookie;
    })
    .filter((cookie): cookie is StoredCookie => cookie !== null);
}

export function stickyCookieExpires(cookie: StoredCookie | undefined): string | undefined {
  if (!cookie) return undefined;
  if (cookie.expires) return new Date(cookie.expires).toISOString();
  if (cookie.maxAge !== undefined && cookie.maxAge > 0) {
    return new Date(Date.now() + cookie.maxAge * 1000).toISOString();
  }

  const parts = cookie.value.split("|");
  const sticky = parts[1] === "1";
  if (!sticky) return undefined;
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

export function isPersistentAuthCookie(cookie: StoredCookie | undefined): boolean {
  if (!cookie) return false;
  if (cookie.maxAge !== undefined) return cookie.maxAge > 0;
  if (cookie.expires) return Date.parse(cookie.expires) > Date.now();
  return cookie.value.split("|")[1] === "1";
}
