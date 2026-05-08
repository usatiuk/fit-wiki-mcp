export type FetchLike = typeof fetch;

export type StoredAuth = {
  baseUrl: string;
  username?: string;
  cookieHeader: string;
  createdAt: string;
  expiresAt?: string;
  cookies: StoredCookie[];
};

export type StoredCookie = {
  name: string;
  value: string;
  expires?: string;
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

export type AuthStore = {
  get(): Promise<StoredAuth | null>;
  set(auth: StoredAuth): Promise<void>;
  delete(): Promise<boolean>;
};

export type AuthProvider = {
  getCookieHeader(): Promise<string | undefined>;
};

export type LoginResult = {
  storedAuth: StoredAuth;
  status: AuthStatus;
};

export type AuthStatus = {
  loggedIn: boolean;
  source: "env" | "keychain" | "none" | "provided";
  username?: string;
  expiresAt?: string;
  message: string;
};

export type SearchResult = {
  title: string;
  pageId: string;
  url: string;
  namespace?: string;
  hits?: number;
  lastModified?: string;
  snippet?: string;
};

export type IndexEntry = {
  type: "namespace" | "page";
  title: string;
  pageId?: string;
  namespace?: string;
  url: string;
};

export type PageReadFormat = "markdown" | "raw" | "html";

export type PageReadResult = {
  pageId: string;
  url: string;
  format: PageReadFormat;
  title?: string;
  content: string;
  license: string;
  licenseUrl: string;
};

export type FileEntry = {
  kind: "image" | "pdf" | "file" | "link";
  url: string;
  title?: string;
  mimeType?: string;
  extension?: string;
  source: "img" | "href";
};

export type DownloadedFile = {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
};

export type ToolJson = Record<string, unknown> | unknown[];

