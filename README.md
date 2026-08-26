# PremiumCMS themes

Themes for [EmDash](https://docs.emdashcms.com). A theme is a **complete Astro
site** — layouts, pages, components, styles — plus a **seed** that bootstraps the
database with collections, fields, taxonomies, menus, widget areas, sections and
sample content on first run.

```
themes/<slug>/
  package.json        emdash.seed points at the seed file
  astro.config.mjs    the emdash() integration: database, storage, plugins
  wrangler.jsonc      Cloudflare resources (D1, R2, worker loader, crons)
  seed/seed.json      schema + content as code
  src/
    worker.ts         Cloudflare entrypoint
    live.config.ts    the _emdash live collection
    layouts/ pages/ components/ styles/
  .agents/skills/     EmDash's own authoring guides, shipped with the template
```

## Start here

**`themes/apex`** is the reference theme *and* the apex project — the site
premium-cms.com runs on. It is a blog on Cloudflare (D1 + R2), taken from
EmDash's `blog-cloudflare` template and pinned to published package versions,
and it covers the full CMS surface: two collections (`posts`,
`pages`), two taxonomies (`category`, `tag`), a menu, two widget areas, two
reusable sections, RSS, search, and eight sample posts.

```bash
cd themes/apex
bun install
npx astro check      # 0 errors
npx astro build
npx astro dev        # then visit /_emdash/admin
```

## Adding a theme

```bash
bin/new-theme.sh <slug> [template]     # template defaults to blog-cloudflare
cd themes/<slug> && bun install && npx astro build
```

Available upstream templates:

| Template | What it gives you |
| --- | --- |
| `blog-cloudflare` | posts, pages, taxonomies, menus, widget areas, RSS, search |
| `marketing-cloudflare` | landing pages built from custom Portable Text blocks |
| `portfolio-cloudflare` | editorial portfolio, image-led layouts |
| `starter-cloudflare` | minimal |

The script copies from the EmDash checkout at `../premium-cms-image/templates/`
when it is present — so new themes always match the image we deploy — and falls
back to GitHub otherwise.

**It also rewrites dependency specifiers.** The upstream templates live in
EmDash's pnpm workspace and declare `workspace:*` and `catalog:` versions, which
mean nothing outside it. The script pins them to published versions from a table
in `bin/new-theme.sh`, and *warns* about any specifier it has no pin for — if you
see that warning, add the pin rather than ignoring it, or `install` will fail.

## Content is code

Everything in `seed/seed.json` is theme code and belongs in git. The seed is what
makes a theme reproducible: collections and their fields, taxonomies and terms,
menus, widget areas, reusable sections, and sample content.

Change the seed, not the admin, for anything that should survive a reseed. Use
the admin for what a seed cannot express — secrets, uploaded media, one-off edits.

## Themes ship plugins two ways

**Installed plugins** are listed in `astro.config.mjs` under the `emdash()`
integration. `apex` runs `@emdash-cms/plugin-forms` in-process and
`@emdash-cms/plugin-webhook-notifier` sandboxed:

```js
emdash({
  database: d1({ binding: "DB", session: "auto" }),
  storage: r2({ binding: "MEDIA" }),
  plugins: [formsPlugin()],
  sandboxed: [webhookNotifier],
  sandboxRunner: sandbox(),
})
```

**Theme-local plugins** live inside the theme and exist to register custom
Portable Text blocks, so editors can insert them in the admin. The
`marketing-cloudflare` template is the reference for this pattern — see
`../premium-cms-image/templates/marketing-cloudflare/src/plugins/marketing-blocks/index.ts`.
Register with an absolute `file://` entrypoint; a relative path fails because
the virtual `emdash/plugins` module has no on-disk location to resolve against:

```js
plugins: [{
  id: "marketing-blocks",
  version: "0.1.0",
  entrypoint: new URL("./src/plugins/marketing-blocks/index.ts", import.meta.url).href,
}]
```

Reusable plugins belong in the **`premium-cms-plugins`** repo instead; only
block registration for one theme's own layouts belongs here.

## Deploying

`wrangler.jsonc` names each theme's own D1 database and R2 bucket (`<slug>-db`,
`<slug>-media`). `npm run deploy` runs `astro build && wrangler deploy`. The
Cloudflare adapter also enables sessions over a `SESSION` KV binding, which no
upstream template declares — provision it with the rest of the resources on
first deploy.

## Reference

The EmDash checkout at `../premium-cms-image` is the source of truth: the
templates are in `templates/`, the theme documentation in
`docs/src/content/docs/themes/`. Each theme also ships `.agents/skills/` —
EmDash's own guides for building sites, creating plugins and using the CLI.
