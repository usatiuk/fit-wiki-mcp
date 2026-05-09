# FIT Wiki MCP

[![npm version](https://img.shields.io/npm/v/fit-wiki-mcp.svg)](https://www.npmjs.com/package/fit-wiki-mcp)
[![npm downloads](https://img.shields.io/npm/dm/fit-wiki-mcp.svg)](https://www.npmjs.com/package/fit-wiki-mcp)
[![CI](https://github.com/usatiuk/fit-wiki-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/usatiuk/fit-wiki-mcp/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.html)

Model Context Protocol server and CLI for [FIT Wiki](https://fit-wiki.cz/obsah). Public pages work without auth; logged-in pages use DokuWiki cookies stored in the OS credential store.

## Install

```bash
npm install -g fit-wiki-mcp
```

Local development:

```bash
npm install
npm run build
npm test
```

Requires Node.js 22.13 or newer. PDF page rendering uses PDF.js with the native `@napi-rs/canvas` backend pulled transitively by `pdfjs-dist`.

Optional live regression tests hit FIT Wiki directly. Public smoke tests always run; authenticated DML page/file/PDF checks run when `FITWIKI_COOKIE`, both credential env vars, or a local keychain login is available:

```bash
FITWIKI_TEST_USERNAME=... FITWIKI_TEST_PASSWORD=... npm run test:live
```

## Login

No manual browser-cookie copying. Login through the CLI:

```bash
npx -y fit-wiki-mcp@latest auth login --username YOUR_FIT_WIKI_USERNAME
```

Password is prompted hidden, posted once to FIT Wiki, and never stored. The returned DokuWiki cookie is stored in the OS credential store:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret

Check or delete local auth:

```bash
npx -y fit-wiki-mcp@latest auth status
npx -y fit-wiki-mcp@latest auth logout
```

`FITWIKI_COOKIE` still works as an env override for CI or debugging.

## MCP Config

After global install:

```json
{
  "mcpServers": {
    "fit-wiki": {
      "command": "fit-wiki-mcp"
    }
  }
}
```

Without global install:

```json
{
  "mcpServers": {
    "fit-wiki": {
      "command": "npx",
      "args": ["-y", "fit-wiki-mcp@latest"]
    }
  }
}
```

opencode config uses the same local MCP command:

```json
{
  "mcp": {
    "fit-wiki": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "fit-wiki-mcp@latest"]
    }
  }
}
```

Optional env:

```json
{
  "env": {
    "FITWIKI_BASE_URL": "https://fit-wiki.cz",
    "FITWIKI_COOKIE": "DokuWiki=...; DW..."
  }
}
```

## Tools

- `fitwiki_search`: live DokuWiki search.
- `fitwiki_read_page`: read page by id/URL as markdown, raw wiki syntax, or clean HTML. Use file/PDF tools too when diagrams, scans, or embedded figures matter.
- `fitwiki_list_index`: list visible index namespaces/pages.
- `fitwiki_find_files`: find images, PDFs, and downloadable files linked from a page.
- `fitwiki_get_file`: download same-origin media/files. Raster images return MCP image content, SVGs return rendered PNG image content, PDFs/files return embedded binary resource blobs.
- `fitwiki_pdf_info`: inspect a PDF's page count, labels, outline, and metadata.
- `fitwiki_pdf_page_text`: extract text from one PDF page.
- `fitwiki_pdf_page_image`: render one PDF page as MCP `image/png`; prefer this for diagrams, scans, formulas, tables, and layout-dependent answers.
- `fitwiki_export_pdf`: export a page as PDF when visual layout, formulas, diagrams, or embedded images matter.
- `fitwiki_auth_check`: verify current auth source.

Binary responses are capped at 10 MB.

PDF tools cache downloaded files under the OS temp directory by default for 1 hour, capped at 50 MB. Override with `FITWIKI_CACHE_DIR`, `FITWIKI_CACHE_TTL_MS`, `FITWIKI_CACHE_MAX_BYTES`, or disable with `FITWIKI_CACHE_DISABLED=1`.

## License

Code is licensed under AGPL-3.0-or-later.

FIT Wiki footer says content is licensed as CC BY-NC-SA 4.0 unless a page says otherwise. This server returns source URLs and license metadata where relevant.
