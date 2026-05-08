import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntrypoint(importMetaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;

  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}
