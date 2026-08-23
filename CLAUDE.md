# Working in premium-cms-themes

Themes are **content-as-code**: `themes/<id>/seed/` (seed.json + one-file-per-entry
`content/<collection>/<slug>.json` + `sections/*.json`) plus `theme.json`,
`README.md`, `public/`, screenshots. Each theme has a live demo project
(`demos.json`; `<id>.premium-cms.com`) — `premiumcms`'s demo is premium-cms.com
itself. The shared frontend lives in `frontend-template/` and the plugin
frontends in the plugins repo; **theme work should not touch those**.

## The fast loop — changes go live in seconds

```bash
bin/dev-theme.sh <theme-id> [--watch]     # local seed → the theme's live demo, no CI
```

Content, menus, sections, widget areas, plugin settings and plugin calls are
all db-backed: `dev-theme.sh` composes the seed dir and applies it straight to
the demo's `/seed-api` (auth is self-configuring on this machine). `--watch`
re-applies on every file save. There is NO deployment to wait for — the
frontend template is already served by the platform.

What the fast loop can NOT do (needs a commit + push):
- `public/` assets — a platform-hosted site never serves the theme repo's
  `public/`; reference images by absolute URL (the saastemly pattern:
  jsDelivr against the theme's template repo) or upload as media.
- `theme.json` changes (plugins list, colour scheme, listing metadata).
- Anything in `frontend-template/` or plugin frontends (different repos/CI).

## Shipping — push and everything syncs itself

`git push` → CI: template repo sync → marketplace listing → demo reconcile →
**fleet reseed of every project on the theme**. So the committed seed is the
source of truth; the fast loop only previews it on the demo. **Always finish a
dev session with a push**, or the demo and the shipped theme drift apart. New
projects created later pick the theme up from the marketplace automatically —
nothing else to keep in sync by hand.

The reverse direction exists too: after configuring plugins by hand in a
demo's admin, `bin/snapshot-theme.sh <project> <theme>` writes the live plugin
setup back into the theme's seed (secrets, PINs, user links, runtime data are
never exported). Review the git diff before committing.

## Seed rules

- Pages collection has **no `seo` field** — don't put `data.seo` on pages.
- `plugins` section: `{"<plugin-id>": {"settings": {...}, "calls": [...]}}` —
  settings are non-secret only; calls are admin routes run as a system user on
  every apply, so they must stay idempotent (save routes upsert by slug/name;
  `forms/create` needs `"ignoreErrors": true`). Bookings services may use
  `resourceNames` (staff by name) instead of site-local `resourceIds`.
- Never put secrets, API keys, staff PINs or real user accounts in a seed.
- Forms settings key for the post-submit text is `confirmationMessage`
  (there is no `successMessage`).

Demo projects are disposable and rebuilt from `main` — but only through
`demos.json`; never destroy or reconfigure them ad hoc.
