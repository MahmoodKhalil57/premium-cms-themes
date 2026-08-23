# PremiumCMS themes & demos

Everything a PremiumCMS site looks like: the shared **frontend template** (Astro, served by the platform or built on GitHub Pages) and the **themes** built on it — each a seed of pages, sections, menus, plugin settings and demo content.

```
frontend-template/   the base theme: layouts, scripts (shop, bookings, restaurant, forms…), styles, default seed
themes/<id>/         one theme: seed/ (content-as-code), README.md, public/, theme.json, thumbnail + screenshots
demos.json           the demo project for each theme — CI provisions, themes and destroys them to match
```

## How a change ships

Merge to `main` and CI will:

1. Mirror `frontend-template` + each theme's own files into that theme's **template repository** (`premiumcms.templateRepo` in `theme.json`) — the repo projects are generated from and the theme seed is read from.
2. Publish every `theme.json` + screenshots to the marketplace catalogue (and drop removed themes).
3. Reconcile demo projects with `demos.json` (`fleet/demos`: provision + bind theme + plugins + colour scheme for new entries, destroy removed ones), then re-apply every theme's seed (`fleet/sync themes`), so demos always show `main`.
4. If `frontend-template/` changed, ask the image repo to rebuild the platform bundle (optional `IMAGE_DISPATCH_TOKEN`).

No keys needed locally; they live in the repo's `marketplace` environment.

## Create a theme

1. `cp -r themes/dental themes/<id>`; edit `theme.json` (`id` = folder name, `premiumcms.templateRepo` = a new empty GitHub repo `MahmoodKhalil57/premium-cms-<id>-theme` that CI will fill), `README.md`, and the seed.
2. Seeds are plain JSON: `seed/seed.json` (collections, menus, widgets, plugin settings + idempotent plugin calls under `plugins`), `seed/content/<collection>/<slug>.json`, `seed/sections/*.json`. Pages are page-builder blocks (`grapesBlock` html + css). Storefront markers you can drop into any page: `[data-restaurant-menu]`, `[data-booking]`, `[data-reservation]`, `[data-track]`, `[data-staff-app]`, `[data-ec-form="slug"]`, `[data-google-reviews]`, `[data-before-after]`, `[data-faq]`, `[data-product-grid]`.
3. Add screenshots (`thumbnail.png` 1200×800, `screenshot-N.png`), list demos in `demos.json`, open a PR.
