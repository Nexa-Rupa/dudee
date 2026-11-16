# Releasing dudee

The npm package `dudee` is built from `apps/cli`. The build bundles the core, server and roles into one file and copies the web app, roles, README and LICENSE beside it, so `dudee` is the only package to publish.

## Publish a version

1. Set the version in `apps/cli/package.json` and in `VERSION` at the top of `apps/cli/src/index.ts`.
2. Build and test from the repo root:

   ```bash
   pnpm install
   pnpm build
   pnpm test
   ```

3. Check what will be published:

   ```bash
   cd apps/cli && pnpm pack --pack-destination ../../.release
   ```

   Install that file somewhere empty and try `dudee init`, `dudee hire content-creator`, `dudee ui`.

4. Publish (needs your npm login, `npm login` first):

   ```bash
   cd apps/cli && pnpm publish --access public
   ```

## Replacing the old dudee (1.x, "Company Brain")

Publish 2.0.0 over it rather than deleting the package: npm only allows unpublishing in narrow cases, and an unpublished name can't be reused for 24 hours. Then mark the old versions:

```bash
npm deprecate dudee@"<2.0.0" "dudee 2 replaces the Company Brain. Install the latest: npm i -g dudee"
```

People on 1.x keep working; `npm i -g dudee` gives them 2.x. 2.x stores its workspace in `.dude/` (not `~/.dudee/brain.db`), so nothing from 1.x is overwritten.

## Docker image

```bash
docker build -t dudee .
```

The image installs the same packed `dudee` package. To publish it, tag and push to your registry, for example `docker tag dudee ghcr.io/<you>/dudee:2.0.0`.
