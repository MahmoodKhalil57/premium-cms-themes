# PremiumCMS static frontend

This repo is the **Astro frontend + seed** for a PremiumCMS site. The public
site is a **static build on GitHub Pages** — the Astro frontend is never hosted
on Cloudflare. Only the backend (admin panel + REST API + media) runs on
Cloudflare.

On every push / content-publish, GitHub Actions:

1. fetches a content **snapshot** from the backend (`bin/snapshot-to-sqlite.mjs`),
2. builds the site to static HTML against that snapshot (`astro.config.static.mjs`),
3. applies `seed.json` to the backend (`bin/apply-seed.mjs`),
4. deploys `dist/` to GitHub Pages.

Secrets (set by the platform): `BACKEND_URL`, `SITE_URL`, `EMDASH_PREVIEW_SECRET`,
`SEED_SECRET`.
