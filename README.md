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
demos.json            the live demo site for each theme, and its verified page paths
```

## Demos

| Theme  | Demo                        | Cloudflare                                                |
| ------ | --------------------------- | --------------------------------------------------------- |
| `apex` | **https://premium-cms.com** | worker `apex` · `apex-db` · `apex-media` · `apex-session` |

`demos.json` records each theme's demo URL together with the page paths worth
checking (homepage, a post, a taxonomy archive, search, RSS, 404). Every path in
it has been verified to return 200 — keep it that way, so screenshot runs and
smoke checks can rely on it.

## Start here

**`themes/apex`** is the reference theme _and_ the apex project — the site
[premium-cms.com](https://premium-cms.com) runs on. It is a blog on Cloudflare (D1 + R2), taken from
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

| Template               | What it gives you                                          |
| ---------------------- | ---------------------------------------------------------- |
| `blog-cloudflare`      | posts, pages, taxonomies, menus, widget areas, RSS, search |
| `marketing-cloudflare` | landing pages built from custom Portable Text blocks       |
| `portfolio-cloudflare` | editorial portfolio, image-led layouts                     |
| `starter-cloudflare`   | minimal                                                    |

The script copies from the EmDash checkout at `../premium-cms-image/templates/`
when it is present — so new themes always match the image we deploy — and falls
back to GitHub otherwise.

**It also rewrites dependency specifiers.** The upstream templates live in
EmDash's pnpm workspace and declare `workspace:*` and `catalog:` versions, which
mean nothing outside it. The script pins them to published versions from a table
in `bin/new-theme.sh`, and _warns_ about any specifier it has no pin for — if you
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
});
```

**Theme-local plugins** live inside the theme and exist to register custom
Portable Text blocks, so editors can insert them in the admin. The
`marketing-cloudflare` template is the reference for this pattern — see
`../premium-cms-image/templates/marketing-cloudflare/src/plugins/marketing-blocks/index.ts`.
Register with an absolute `file://` entrypoint; a relative path fails because
the virtual `emdash/plugins` module has no on-disk location to resolve against:

```js
plugins: [
  {
    id: "marketing-blocks",
    version: "0.1.0",
    entrypoint: new URL("./src/plugins/marketing-blocks/index.ts", import.meta.url).href,
  },
];
```

Reusable plugins belong in the **`premium-cms-plugins`** repo instead; only
block registration for one theme's own layouts belongs here.

### Email providers

`apex` installs two, deliberately. `cloudflareEmail` sends through the Worker's
`send_email` binding — the _platform's_ Cloudflare account. `cloudflare-email-byo`
(from the plugins repo) sends through credentials the site owner enters in the
admin — _their_ account, domain and quota. EmDash auto-selects a provider only
when exactly one is active, so with both installed the choice is explicit under
Settings → Email.

`cloudflare-email-byo` is consumed through a `file:` dependency on the sibling
plugins repo, since it is not published yet:

```json
"@premium-cms/plugin-cloudflare-email-byo": "file:../../../premium-cms-plugins/plugins/cloudflare-email-byo"
```

That means **the plugin must be built before the theme is** — the descriptor
points at its `dist/`, which is gitignored. Run `npx emdash-plugin build` in
the plugin first. Replace this with a registry install once the publisher
identity resolves.

## Deploying

`wrangler.jsonc` names each theme's own D1 database and R2 bucket (`<slug>-db`,
`<slug>-media`). `npm run deploy` runs `astro build && wrangler deploy`.

The Cloudflare adapter also needs a `SESSION` KV binding that no upstream
template declares. You do not have to create it by hand: `wrangler deploy`
detects it and provisions it on first deploy (that is where `apex-session` came
from).

**Deploy order matters for a new site.** The setup wizard records `site_url`
_write-once_ from the origin of the request that completes it, and passkeys bind
to the domain they were registered on. So attach the custom domain **before**
running setup — otherwise the site is permanently pinned to its
`*.workers.dev` hostname and the admin passkey is registered against the wrong
origin.

Seeding is a two-part story worth knowing. Schema, settings, menus and widget
areas apply on first boot, but **sample content only lands when the setup wizard
runs** — a freshly deployed site shows "No posts yet" until then. Step one can
be driven over HTTP:

```bash
curl -X POST https://<site>/_emdash/api/setup \
  -H "Content-Type: application/json" \
  -d '{"title":"...","tagline":"...","includeContent":true}'
```

Creating the admin user cannot be scripted — EmDash uses passkeys, so
registration has to happen in a browser on the device that will hold the
credential, at `/_emdash/admin/setup`.

## Reference

The EmDash checkout at `../premium-cms-image` is the source of truth: the
templates are in `templates/`, the theme documentation in
`docs/src/content/docs/themes/`. Each theme also ships `.agents/skills/` —
EmDash's own guides for building sites, creating plugins and using the CLI.

## CI/CD

Pushing to `main` deploys **only the themes that changed**. `bin/changed-themes.sh`
diffs the push and emits the affected slugs; the deploy job fans out over just
those. Repo-level files (`bin/`, README, root config) deploy nothing — they
cannot change what a theme's Worker serves. Each theme is its own Astro site
and its own Worker, so with hundreds of them a change to one must never
rebuild the rest.

| Workflow     | Trigger                                     | Does                                                               |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `deploy.yml` | push to `main` under `themes/**`, or manual | build + `wrangler deploy` the changed themes                       |
| `verify.yml` | pull request                                | formatting, JSON validity, `astro check` + build on changed themes |

Manual dispatch takes a comma-separated list of slugs, or blank for every theme
— the escape hatch for redeploying without a code change.

### Required secrets

Set on the repository under **Settings → Secrets and variables → Actions**:

| Secret                  | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A token scoped to this account with Workers Scripts:Edit, D1:Edit, R2:Edit, Workers KV:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID                                                                   |

Deploys fail with an explicit message rather than a wrangler stack trace when
the token is missing.

### Plugins are not chained to this

A push to `premium-cms-plugins` does **not** redeploy themes. The one remaining
coupling is that a theme consuming a plugin through a `file:` dependency needs
that plugin built first, which is why the deploy job checks out the plugins repo
and runs `bin/build-plugin-deps.sh`. That step is a no-op for a theme with no
local plugin dependencies — which is what every theme should look like once
plugins install from the registry instead.

## Hooks

`husky` runs a minimal pre-commit: format staged files, validate JSON/JSONC.
Typechecks and builds stay in CI.

```bash
bun install     # installs the hook via the prepare script
```
