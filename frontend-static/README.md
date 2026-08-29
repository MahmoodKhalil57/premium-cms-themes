# PremiumCMS static frontend

This repo is the **Astro frontend + seed** for a PremiumCMS site. The public
site is a **static build on GitHub Pages** — the Astro frontend is never hosted
on Cloudflare. Only the backend (admin panel + REST API + media) runs on
Cloudflare.

The site is built by the platform, never by GitHub Actions: a push to the
default branch or a content publish makes the GitHub Agent plugin build the
site in a Cloudflare container (`bin/snapshot-to-sqlite.mjs` → `astro build`)
and push `dist/` to `static/<branch>`, which GitHub Pages serves ("deploy from a
branch"). Pull requests get the same build on `static/<pr-branch>` plus a
Cloudflare preview URL.

The build reads the site's content snapshot with the site's preview secret; no
repository secrets are needed any more.

## Pull-request checks (`check:cf` / `test:cf`)

The GitHub Agent plugin builds every pull request from a whitelisted author in a
Cloudflare container: `npm run check:cf` (bin/check-cf.mjs — JSON validity +
`astro check` when installed) → `astro build` against the content snapshot →
the `dist/` is pushed to a `static/<branch>` branch → `npm run test:cf`
(`bun test tests/ci`) → the passing build is hosted as a Cloudflare preview and
`npm run test:preview:cf` (`bun test tests/preview`, `PREVIEW_URL` set) runs
against it. Results land on the PR as a comment and a commit status.
Site repos declare the three scripts in package.json; the tooling sync keeps
`bin/`, `tests/ci/` and `tests/preview/` current.
