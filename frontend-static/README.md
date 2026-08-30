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

## Local development

The frontend renders the site's **content snapshot**, so running it on your
machine needs two values from the site: its backend URL and its preview
secret (the snapshot endpoint is signed with it, and it grants read access to
unpublished content — treat it like a password). A site admin gets both from
`https://<your site>/_emdash/api/settings/preview-secret` while signed in
(JSON with an `env` block ready to paste).

```sh
# .env (never commit it)
BACKEND_URL=https://<your site>
SITE_URL=https://<your site>
EMDASH_PREVIEW_SECRET=prev_…

bun install
bun dev          # = node bin/snapshot-to-sqlite.mjs && astro dev  → http://localhost:4321
```

`bin/snapshot-to-sqlite.mjs` pulls the snapshot into `snapshot.db` (re-run it
to pick up new content; `EMDASH_INCLUDE_DRAFTS=1` includes drafts), and
`astro dev` serves the site from it. `astro build` uses the same file — exactly
what the platform's container build does. Site repos generated before the
`dev` script existed can run the two commands by hand.

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
