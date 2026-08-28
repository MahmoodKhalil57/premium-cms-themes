#!/usr/bin/env bash
#
# Build step of the `master` Worker's Cloudflare Workers Build (root directory
# themes/master; deploy command `bunx wrangler deploy && bash ../../bin/roll.sh`).
#
# A push to this repo means the image, a theme or the platform code moved, so:
#   1. every provisioning-only theme (no database_id) is rebuilt and its golden
#      bundle published to R2, where the projects plugin deploys it into
#      instances;
#   2. master itself is built (the deploy command then ships it and rolls the
#      instance tree from `latest`).
#
# Env (build variables on the Worker): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
# (account that owns the platform-artifacts bucket). THEMES=a,b limits step 1.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

publishable() {
	for d in themes/*/; do
		[ -f "$d/package.json" ] || continue
		[ -f "$d/wrangler.jsonc" ] && grep -q '"database_id"' "$d/wrangler.jsonc" && continue
		basename "$d"
	done
}

if [ -n "${THEMES:-}" ]; then
	mapfile -t LIST < <(echo "$THEMES" | tr ',' '\n' | sed '/^$/d')
else
	mapfile -t LIST < <(publishable)
fi

for t in "${LIST[@]}"; do
	echo "::: theme $t"
	bin/build-plugin-deps.sh "themes/$t"
	( cd "themes/$t" && bun install )
	bin/publish-theme-bundle.sh "$t"
done

echo "::: master"
bin/build-plugin-deps.sh themes/master
( cd themes/master && bun install && bunx astro build )
