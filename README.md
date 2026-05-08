# FIT Wiki MCP

MCP server and CLI for [FIT Wiki](https://fit-wiki.cz/obsah). It reads public pages without auth and can use stored FIT Wiki credentials for logged-in pages.

## Install

```bash
npm install
npm run build
```

## Login

No manual browser-cookie copying. Login through CLI:

```bash
npm run cli -- auth login --username YOUR_FIT_WIKI_USERNAME
```

Password is prompted hidden, posted once to FIT Wiki, and never stored. The returned DokuWiki cookie is stored in the OS credential store:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service/libsecret

Check or delete local auth:

```bash
npm run cli -- auth status
npm run cli -- auth logout
```

`FITWIKI_COOKIE` still works as an env override for CI or debugging.

## MCP Config

After `npm run build`, point your MCP client at:

```json
{
  "mcpServers": {
    "fit-wiki": {
      "command": "node",
      "args": ["/absolute/path/to/fit-wiki-mcp/dist/server.js"]
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
- `fitwiki_export_pdf`: export page as PDF.
- `fitwiki_auth_check`: verify current auth source.

Binary responses are capped at 10 MB.

## License Note

FIT Wiki footer says content is licensed as CC BY-NC-SA 4.0 unless a page says otherwise. This server returns source URLs and license metadata where relevant.

