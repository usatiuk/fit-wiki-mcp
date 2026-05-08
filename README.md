# FIT Wiki MCP

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

## Login

No manual browser-cookie copying. Login through the CLI:

```bash
fitwiki auth login --username YOUR_FIT_WIKI_USERNAME
```

Password is prompted hidden, posted once to FIT Wiki, and never stored. The returned DokuWiki cookie is stored in the OS credential store:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret

Check or delete local auth:

```bash
fitwiki auth status
fitwiki auth logout
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
      "args": ["-y", "fit-wiki-mcp"]
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
- `fitwiki_read_page`: read page by id/URL as markdown, raw wiki syntax, or clean HTML.
- `fitwiki_list_index`: list visible index namespaces/pages.
- `fitwiki_find_files`: find images, PDFs, and downloadable files linked from a page.
- `fitwiki_get_file`: return same-origin images as MCP image content; PDFs/files as embedded binary resources.
- `fitwiki_export_pdf`: export a page as PDF.
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
