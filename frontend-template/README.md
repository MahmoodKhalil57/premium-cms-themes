# PremiumCMS frontend template

The base image for a PremiumCMS site's frontend: the official **EmDash
starter theme**, made fully static and headless. When you click **Set up
frontend on GitHub Pages** in your site's admin, the platform generates your
repository from this template, writes your site's values into
`src/config.ts`, and configures GitHub Pages — no DNS changes, ever.

There is deliberately **no design in this repo**: it is unstyled, semantic
HTML. Design happens in the CMS — the homepage, header, and footer are
page-builder blocks you edit visually in the admin.

## How it fits together

- **Static & headless.** `astro build` pre-renders every page from your
  CMS's public feed (`/frontend-api/*`): home, posts, pages, categories,
  tags. The output is plain HTML served by GitHub Pages — no server logic.
- **Your domain serves it automatically.** The platform reverse-proxies the
  Pages build on your site's own domain. Paths this frontend doesn't
  implement (`/search`, `/rss.xml`) fall through to the CMS, and
  `/_emdash/admin` always stays with the CMS.
- **Designer-owned surfaces.** Three CMS objects control the look:
  - the `home` **page** — the homepage body (page-builder block)
  - the `site-header` / `site-footer` **sections** (Manage → Sections) —
    the chrome, including the mobile drawer
  Their designs carry empty marker elements the platform fills at build
  time: `[data-menu="…"]` (Menus manager), `[data-widget-area="…"]`
  (Widgets manager), `[data-site-title]`, `[data-site-tagline]`,
  `[data-theme-switcher]`. Keep markers empty; style everything around them.
- **Content as code.** `seed/` is a living migration applied to the CMS on
  every deploy, before the build (update-on-conflict, matched by slug):
  - `seed/seed.json` — settings, menus, redirects, widget areas
  - `seed/content/<collection>/<slug>.json` — one content entry per file
  - `seed/sections/<slug>.json` — one section per file
  - `seed/schemas/*.schema.json` — JSON Schemas every seed file's `$schema`
    points at, so your IDE validates and autocompletes them
  Sensitive values never enter the repo: write `{"$env": "NAME"}` and set
  `NAME` in the workflow environment. The apply step authenticates with the
  `CMS_SEED_TOKEN` repository secret (set automatically at creation).
- **Fail-soft builds.** If the CMS is unreachable at build time, the build
  still succeeds with empty content — a deploy never breaks on a blip.

## Forms

Install **Forms** from the admin Marketplace, design a form in **Builder**
(drag-and-drop fields, multi-step, conditions, validation, notifications —
the sidebar entry appears once the plugin is installed), then place it:

- in an Astro page: `import CmsForm from "../components/CmsForm.astro"` and
  `<CmsForm id="contact" />` (pre-rendered at build time), or
- anywhere — including page-builder sections — with
  `<div data-cms-form="contact"></div>` (hydrated at runtime).

Submissions land in Plugins → Forms → Submissions; notifications, digests,
webhooks, spam protection and CSV export are configured per form.

## Shop

Install **Commerce** from the admin Marketplace and add the Stripe secret key
(Plugins → Commerce → Settings; enable *pay-later* orders if you want to
take orders without online payment). Products are the **Products**
collection this seed creates (`seed/content/products/*.json` are samples —
replace or delete them). The template ships:

- `/products` and `/products/<slug>` — static product pages (price, stock
  badge, add to cart); prices display in `STORE_CURRENCY` (workflow env,
  default `usd`) and are charged from the CMS, never from the browser
- `/cart` — cart + checkout (card via Stripe Checkout, or pay-later)
- `/checkout/success` — order confirmation (verifies the payment with the CMS)

Markers for page-builder sections: `<button data-add-to-cart="<slug>">`
anywhere, `<span data-cart-count></span>` in the header, `[data-cart]` /
`[data-order]` containers if you design your own cart or receipt page.
Orders, inventory, refunds and exports live in Plugins → Commerce.

## Editing

| What                    | Where                                        |
| ----------------------- | -------------------------------------------- |
| Homepage design         | Admin → Pages → Home → Edit design           |
| Header / footer design  | Admin → Manage → Sections → Edit design      |
| Navigation links        | Admin → Manage → Menus                       |
| Footer / sidebar widgets| Admin → Manage → Widgets                     |
| Redirects               | Admin → Manage → Redirects                   |
| Products / orders       | Admin → Content → Products, Plugins → Commerce |
| Page templates (code)   | `src/pages/` — anything you add shadows the CMS route of the same path |
| CMS URL & identity      | `src/config.ts` (written by the platform)    |

Admin edits publish to the live frontend at the next push or workflow
dispatch (the deploy re-applies the seed, then pre-renders).

## Local development

```bash
bun install
bun run dev          # content from the CMS_URL in src/config.ts
bun run seed         # apply seed/ to the CMS (needs CMS_SEED_TOKEN)
```
