import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type PackageMetadata = {
  name?: string;
  version?: string;
  homepage?: string;
};

const fallbackPackage = {
  name: "fit-wiki-mcp",
  version: "0.0.0",
  homepage: "https://github.com/usatiuk/fit-wiki-mcp#readme"
};

function readPackageMetadata(): PackageMetadata {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;
  } catch {
    return fallbackPackage;
  }
}

const packageMetadata = readPackageMetadata();

export const PACKAGE_NAME = packageMetadata.name ?? fallbackPackage.name;
export const PACKAGE_VERSION = packageMetadata.version ?? fallbackPackage.version;
export const PACKAGE_HOMEPAGE = packageMetadata.homepage ?? fallbackPackage.homepage;
