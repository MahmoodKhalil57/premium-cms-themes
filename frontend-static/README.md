# PremiumCMS static frontend

This repo is the **Astro frontend + seed** for a PremiumCMS site. The public
site is a **static build on GitHub Pages** — the Astro frontend is never hosted
on Cloudflare. Only the backend (admin panel + REST API + media) runs on
Cloudflare.

The site is built by the platform, never by GitHub Actions: a push to the
default branch or a content publish makes the GitHub Agent plugin build the
site in a Cloudflare container (live from the backend's content snapshot)
and push `dist/` to `static/<branch>`, which GitHub Pages serves ("deploy from a
branch"). Pull requests get the same build on `static/<pr-branch>` plus a
Cloudflare preview URL.

The build reads the site's content snapshot with the frontend service account's
API token (`EMDASH_API_TOKEN`); no repository secrets are needed any more.

## Local development

The frontend renders from the site's **live backend**, so running it on your
machine needs two values from the site: its backend URL and the **frontend API
token** — the token of the site's built-in frontend service account (nobody
signs in as it; it may only read content, schema and the snapshot, drafts
included — treat it like a password). A site admin gets both from
`https://<your site>/_emdash/api/settings/frontend-token` while signed in
(JSON with an `env` block ready to paste; `POST …/frontend-token/rotate`
replaces it).

```sh
# .env (never commit it)
BACKEND_URL=https://<your site>
SITE_URL=https://<your site>
EMDASH_API_TOKEN=ec_pat_…

bun install
bun dev          # astro dev, live-connected  → http://localhost:4321
```

With those two values set, `bun dev` **live-connects** to the deployed
instance the same way the platform's builds and previews do: EmDash's data
layer reads an in-memory database that keeps itself refreshed from the
backend's `/_emdash/api/snapshot` (`@premium-cms/emdash/db/snapshot-live`),
so publishing in the admin shows up on the next reload — no snapshot file, no
pull step (`EMDASH_INCLUDE_DRAFTS=1` renders drafts too). The dev server also
proxies `/_emdash/*` to the backend, so client-side features (forms, commerce)
work same-origin. `astro build` renders from the same live source —
the platform's container builds do exactly that too.

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
