#!/usr/bin/env node
import readline from "node:readline";
import { Writable } from "node:stream";
import { loginWithPassword, getAuthStatus } from "./auth.js";
import { DEFAULT_BASE_URL } from "./constants.js";
import { isEntrypoint } from "./entrypoint.js";
import { KeychainAuthStore } from "./keychain.js";

type ParsedArgs = {
  command?: string;
  subcommand?: string;
  flags: Record<string, string | true>;
};

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.command !== "auth") {
    printHelp();
    process.exitCode = args.command ? 1 : 0;
    return;
  }

  const store = new KeychainAuthStore();
  const baseUrl = stringFlag(args, "base-url") ?? process.env.FITWIKI_BASE_URL ?? DEFAULT_BASE_URL;

  if (args.subcommand === "login") {
    const username = stringFlag(args, "username") ?? (await prompt("FIT Wiki username: "));
    const password = await promptHidden("FIT Wiki password: ");
    const { storedAuth, status } = await loginWithPassword({ baseUrl, username, password });
    await store.set(storedAuth);
    console.log(`Logged in: ${status.username ?? storedAuth.username ?? username}`);
    console.log(`Stored in OS credential store: fit-wiki-mcp / fit-wiki.cz`);
    if (storedAuth.expiresAt) console.log(`Cookie expires around: ${storedAuth.expiresAt}`);
    return;
  }

  if (args.subcommand === "status") {
    const stored = await store.get();
    const cookieHeader = process.env.FITWIKI_COOKIE || stored?.cookieHeader;
    const source = process.env.FITWIKI_COOKIE ? "env" : stored ? "keychain" : "none";
    const status = await getAuthStatus({ baseUrl, cookieHeader, source });
    console.log(status.loggedIn ? "Logged in" : "Not logged in");
    console.log(`Source: ${status.source}`);
    console.log(`Message: ${status.message}`);
    if (status.username || stored?.username) console.log(`Username: ${status.username ?? stored?.username}`);
    if (stored?.expiresAt) console.log(`Cookie expires around: ${stored.expiresAt}`);
    return;
  }

  if (args.subcommand === "logout") {
    const deleted = await store.delete();
    console.log(deleted ? "Deleted local FIT Wiki credentials" : "No local FIT Wiki credentials found");
    return;
  }

  printHelp();
  process.exitCode = 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      flags[key] = argv[i + 1];
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return {
    command: positionals[0],
    subcommand: positionals[1],
    flags
  };
}

function stringFlag(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  return typeof value === "string" ? value : undefined;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptHidden(question: string): Promise<string> {
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const rl = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function printHelp(): void {
  console.log(`fit-wiki-mcp auth login [--username USER] [--base-url URL]
fit-wiki-mcp auth status [--base-url URL]
fit-wiki-mcp auth logout

Alias after global install:
fitwiki auth login [--username USER]

Credentials are stored in the OS credential store:
- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret`);
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
