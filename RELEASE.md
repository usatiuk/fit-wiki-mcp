# Release Flow

The package publishes through npm Trusted Publishing with GitHub Actions OIDC.

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
