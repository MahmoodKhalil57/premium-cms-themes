# PremiumCMS static frontend

This repo is the **Astro frontend + seed** for a PremiumCMS site. The public
site is a **static build on GitHub Pages** — the Astro frontend is never hosted
on Cloudflare. Only the backend (admin panel + REST API + media) runs on
Cloudflare.

On every push / content-publish, GitHub Actions:

1. fetches a content **snapshot** from the backend (`bin/snapshot-to-sqlite.mjs`),
2. builds the site to static HTML against that snapshot (the site's own `astro.config.mjs`),
3. deploys `dist/` to GitHub Pages.

Secrets (set by the platform): `BACKEND_URL`, `SITE_URL`, `EMDASH_PREVIEW_SECRET`,
`SEED_SECRET`.

## Pull-request checks (`check:cf` / `test:cf`)

The GitHub Agent plugin builds every pull request from a whitelisted author in a
Cloudflare container: `npm run check:cf` (bin/check-cf.mjs — JSON validity +
`astro check` when installed) → `astro build` against the content snapshot →
the `dist/` is pushed to a `static/<branch>` branch → `npm run test:cf`
(`bun test tests/ci`). Results land on the PR as a comment and a commit status.
Site repos declare both scripts in package.json; the tooling sync keeps
`bin/` and `tests/ci/` current.
