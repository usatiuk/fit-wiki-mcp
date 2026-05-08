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

Optional live regression tests hit FIT Wiki directly. Public smoke tests always run; authenticated DML page/file/PDF checks run when either `FITWIKI_COOKIE` or both credential env vars are set:

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
- `fitwiki_get_file`: return same-origin raster images as MCP image content; SVGs as rendered PNG image plus original SVG resource; PDFs/files as embedded binary resources. PDF outputs include a visual-inspection hint so agents do not rely only on extracted text for diagrams/scans.
- `fitwiki_export_pdf`: export a page as PDF when visual layout, formulas, diagrams, or embedded images matter.
- `fitwiki_auth_check`: verify current auth source.

Binary responses are capped at 10 MB.

## Maintainer Release Flow

The package is intended to publish through npm Trusted Publishing with GitHub Actions OIDC.

First publish must be bootstrapped manually because `npm trust` requires the package to already exist:

```bash
npm login
npm publish
npm install -g npm@^11.10.0
npm trust github fit-wiki-mcp --repo usatiuk/fit-wiki-mcp --file release.yml
```

After that, release from GitHub:

1. Open Actions -> Release.
2. Run workflow.
3. Choose `patch`, `minor`, `major`, or `prerelease`.
4. Leave `dry_run` off for a real release.

The release workflow bumps `package.json`, pushes `vX.Y.Z`, publishes to npm, and creates a GitHub Release.

## License

Code is licensed under AGPL-3.0-or-later.

FIT Wiki footer says content is licensed as CC BY-NC-SA 4.0 unless a page says otherwise. This server returns source URLs and license metadata where relevant.
