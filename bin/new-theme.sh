#!/usr/bin/env bash
#
# Scaffold a new PremiumCMS theme into themes/<slug>.
#
#   bin/new-theme.sh <slug> [template]
#
# `template` is an official EmDash template name; it defaults to
# blog-cloudflare, the same one themes/apex is built from.
#
#   blog-cloudflare        posts, pages, taxonomies, menus, widget areas, RSS, search
#   marketing-cloudflare   landing pages with custom Portable Text blocks
#   portfolio-cloudflare   editorial portfolio, image-led layouts
#   starter-cloudflare     minimal
#
# Themes are pulled from the EmDash checkout at ../premium-cms-image when it is
# present (always in step with the image we deploy), and from GitHub otherwise.
set -euo pipefail

SLUG="${1:-}"
TEMPLATE="${2:-blog-cloudflare}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_EMDASH="$ROOT/../premium-cms-image/templates/$TEMPLATE"

if [ -z "$SLUG" ]; then
	echo "usage: bin/new-theme.sh <slug> [template]" >&2
	exit 1
fi
if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
	echo "error: slug must be lowercase letters, digits and hyphens (got '$SLUG')" >&2
	exit 1
fi
if [ -e "$ROOT/themes/$SLUG" ]; then
	echo "error: themes/$SLUG already exists" >&2
	exit 1
fi

mkdir -p "$ROOT/themes"
if [ -d "$LOCAL_EMDASH" ]; then
	echo "Copying from the local EmDash checkout: $LOCAL_EMDASH"
	cp -r "$LOCAL_EMDASH" "$ROOT/themes/$SLUG"
	rm -rf "$ROOT/themes/$SLUG"/{node_modules,dist,.astro} "$ROOT/themes/$SLUG/CHANGELOG.md"
else
	echo "No local EmDash checkout; fetching the template from GitHub"
	npx --yes giget@latest "gh:emdash-cms/emdash/templates/$TEMPLATE" "$ROOT/themes/$SLUG"
fi

cd "$ROOT/themes/$SLUG"

# The templates live in the EmDash pnpm workspace, so their manifests use
# `workspace:*` and `catalog:` specifiers that mean nothing outside it. Pin
# them to the published versions this repo tracks.
python3 - "$SLUG" <<'PY'
import json, pathlib, sys

slug = sys.argv[1]
PINS = {
    "@astrojs/cloudflare": "^14.2.5",
    "@astrojs/react": "^6.0.4",
    "@astrojs/check": "^0.9.10",
    "@cloudflare/workers-types": "^5.20260826.1",
    "@emdash-cms/cloudflare": "^0.35.0",
    "@emdash-cms/plugin-forms": "^0.2.5",
    "@emdash-cms/plugin-webhook-notifier": "^0.2.0",
    "@emdash-cms/plugin-embeds": "^0.1.43",
    "@emdash-cms/plugin-color": "^0.2.0",
    "@emdash-cms/plugin-field-kit": "^0.1.0",
    "@iconify-json/ph": "^1.2.2",
    "astro": "^7.0.0",
    "astro-iconset": "^0.0.4",
    "emdash": "^0.35.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "typescript": "^6.0.3",
    "wrangler": "^4.124.0",
}

pkg = pathlib.Path("package.json")
d = json.loads(pkg.read_text())
d["name"] = f"@premium-cms/theme-{slug}"
d["version"] = "0.1.0"

unpinned = []
for field in ("dependencies", "devDependencies"):
    for name, spec in list(d.get(field, {}).items()):
        if spec.startswith(("workspace:", "catalog:")):
            if name in PINS:
                d[field][name] = PINS[name]
            else:
                unpinned.append(f"{field}.{name}")
d.setdefault("devDependencies", {}).setdefault("typescript", PINS["typescript"])
pkg.write_text(json.dumps(d, indent="\t") + "\n")

if unpinned:
    print("  WARNING: no pin known for: " + ", ".join(unpinned))
    print("  Add them to PINS in bin/new-theme.sh and set a real version by hand.")

# Name the Cloudflare resources after the theme rather than the template default.
w = pathlib.Path("wrangler.jsonc")
if w.exists():
    t = w.read_text()
    t = t.replace('"name": "my-emdash-site"', f'"name": "{slug}"')
    t = t.replace('"database_name": "my-emdash-site"', f'"database_name": "{slug}-db"')
    t = t.replace('"bucket_name": "my-emdash-media"', f'"bucket_name": "{slug}-media"')
    w.write_text(t)

# Stamp the seed so the admin shows the theme, not the upstream template.
s = pathlib.Path("seed/seed.json")
if s.exists():
    seed = json.loads(s.read_text())
    seed.setdefault("meta", {})["name"] = slug.replace("-", " ").title()
    seed["meta"]["author"] = "PremiumCMS"
    s.write_text(json.dumps(seed, indent="\t") + "\n")
PY

echo
echo "Scaffolded themes/$SLUG from $TEMPLATE"
echo "Next:"
echo "  1. cd themes/$SLUG && bun install"
echo "  2. npx astro check && npx astro build"
echo "  3. edit seed/seed.json   # collections, menus, content"
echo "  4. edit src/             # layouts, pages, components, styles"
