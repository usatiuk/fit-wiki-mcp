import { KEYCHAIN_ACCOUNT, SERVICE_NAME } from "./constants.js";
import type { AuthStore, StoredAuth } from "./types.js";

export class KeychainAuthStore implements AuthStore {
  constructor(
    private readonly service = SERVICE_NAME,
    private readonly account = KEYCHAIN_ACCOUNT
  ) {}

  async get(): Promise<StoredAuth | null> {
    const entry = await this.entry();
    const raw = entry.getPassword();
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  }

  async set(auth: StoredAuth): Promise<void> {
    const entry = await this.entry();
    entry.setPassword(JSON.stringify(auth));
  }

  async delete(): Promise<boolean> {
    const entry = await this.entry();
    try {
      entry.deletePassword();
      return true;
    } catch {
      return false;
    }
  }

  private async entry() {
    try {
      const { Entry } = await import("@napi-rs/keyring");
      return new Entry(this.service, this.account);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OS credential store unavailable. macOS uses Keychain, Windows uses Credential Manager, Linux needs Secret Service/libsecret. ${detail}`
      );
    }
  }
}

export class MemoryAuthStore implements AuthStore {
  private value: StoredAuth | null = null;

  constructor(initial?: StoredAuth | null) {
    this.value = initial ?? null;
  }

  async get(): Promise<StoredAuth | null> {
    return this.value;
  }

  async set(auth: StoredAuth): Promise<void> {
    this.value = auth;
  }

  async delete(): Promise<boolean> {
    const hadValue = this.value !== null;
    this.value = null;
    return hadValue;
  }
}

export class StoreAuthProvider {
  constructor(private readonly store: AuthStore) {}

  async getCookieHeader(): Promise<string | undefined> {
    return (await this.store.get())?.cookieHeader;
  }
}

export class EnvFirstAuthProvider {
  constructor(
    private readonly store: AuthStore,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async getCookieHeader(): Promise<string | undefined> {
    if (this.env.FITWIKI_COOKIE) return this.env.FITWIKI_COOKIE;
    try {
      return (await this.store.get())?.cookieHeader;
    } catch {
      return undefined;
    }
  }

  async source(): Promise<"env" | "keychain" | "none"> {
    if (this.env.FITWIKI_COOKIE) return "env";
    try {
      return (await this.store.get()) ? "keychain" : "none";
    } catch {
      return "none";
    }
  }
}
