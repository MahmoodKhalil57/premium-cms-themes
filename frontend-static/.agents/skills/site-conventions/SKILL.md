---
name: site-conventions
description: How this PremiumCMS site repository is laid out and what a change to it must respect. Read before editing anything in this repo.
---

# Site conventions

This repository is a PremiumCMS site: an Astro frontend plus the content the
CMS keeps in git. The platform builds it in a container on every push and
serves the result from `static/<branch>`; pull requests get a preview.

## Layout

- `src/` — the Astro frontend (layouts, pages, components, styles, plugin
  overlays under `src/plugins/`). Match the existing style: tabs, double quotes,
  one component per file.
- `seed/` — the site's seed as a directory of JSON files (collections, fields,
  menus, entries, `.schemas/`). It is applied by the platform on every roll;
  change the JSON, never hand-edit generated ids.
- `content/` — git-backed collections and plugin storage (e.g. form
  definitions). Saving in the admin commits here; edits in a PR are fine.
- `bin/`, `tests/ci/`, `tests/preview/` — platform tooling, synced from the
  template. Do not edit; put project checks in `check:cf` / `test:cf` /
  `test:preview:cf` scripts instead.
- `.agents/skills/` — skills like this one, loaded by the issue agent.
  `.mcp.json` — extra MCP servers the agent may use.

## Rules for changes

- Keep JSON valid (`npm run check:cf` parses every file under `seed/` and
  `content/`); keep the schema files in `seed/.schemas/` untouched.
- Do not add dependencies unless the issue asks for one; `bun install` must
  keep working.
- Never edit `static/*` branches or anything under `dist/`.
- Public pages are rendered from the content snapshot; a content change belongs
  in `seed/` or `content/`, a presentation change in `src/`.
