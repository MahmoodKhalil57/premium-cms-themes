#!/usr/bin/env bash
# Mirror the composed frontend (shared template + the theme's plugin frontends,
# see bin/compose-frontend.sh) + each theme's own files into that theme's
# template repository (the one projects are generated from and theme-seed reads):
#   compose(frontend-template, theme.json plugins) (minus seed/, README.md, public/prints/)  →  <repo>/
#   themes/<id>/{seed,README.md,public}                             →  <repo>/
# Pushes when --push is given. Repos come from themes/<id>/theme.json
# (premiumcms.templateRepo). CI authenticates with per-repo deploy keys (TEMPLATE_KEY_<ID>); locally your own git auth is used.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
PUSH="${1:-}"
# CI: one write deploy key per template repo, passed as TEMPLATE_KEY_<ID> (upper-case theme id).
use_key() {
	local var="TEMPLATE_KEY_$(echo "$1" | tr '[:lower:]-' '[:upper:]_')"
	local key="${!var:-}"
	if [ -n "$key" ]; then
		mkdir -p ~/.ssh && chmod 700 ~/.ssh
		printf '%s\n' "$key" > ~/.ssh/key_$1 && chmod 600 ~/.ssh/key_$1
		grep -q github.com ~/.ssh/known_hosts 2>/dev/null || ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
		export GIT_SSH_COMMAND="ssh -i ~/.ssh/key_$1 -o IdentitiesOnly=yes"
		URL_PREFIX="git@github.com:"
	else
		unset GIT_SSH_COMMAND
		URL_PREFIX="https://github.com/"
	fi
}
git config --global user.email "ci@premium-cms.com" 2>/dev/null || true
git config --global user.name "PremiumCMS CI" 2>/dev/null || true
for d in "$ROOT"/themes/*/; do
	id="$(basename "$d")"
	[ -f "$d/theme.json" ] || continue
	repo="$(python3 -c "import json,sys;print((json.load(open(sys.argv[1])).get('premiumcms') or {}).get('templateRepo',''))" "$d/theme.json")"
	[ -n "$repo" ] || { echo "$id: no templateRepo"; continue; }
	use_key "$id"
	dst="$WORK/$id"
	[ -d "$dst/.git" ] || git clone -q "${URL_PREFIX}${repo}.git" "$dst"
	# The template for this theme = shared core + the frontends of the plugins the theme lists (bin/compose-frontend.sh).
	plugins="$(python3 -c "import json,sys;print(','.join((json.load(open(sys.argv[1])).get('premiumcms') or {}).get('plugins',[])))" "$d/theme.json")"
	composed="$WORK/composed-$id"; bash "$ROOT/bin/compose-frontend.sh" "$composed" "$plugins" "$id"
	rsync -a --delete --exclude '.git' --exclude 'seed/' --exclude 'README.md' --exclude 'public/prints/' --exclude 'node_modules' --exclude 'dist' --exclude '.astro' "$composed/" "$dst/"
	if [ "$id" != "premiumcms" ]; then
		rm -rf "$dst/seed"; cp -r "$d/seed" "$dst/seed"
		[ -f "$d/README.md" ] && cp "$d/README.md" "$dst/README.md"
		[ -d "$d/public" ] && cp -r "$d/public/." "$dst/public/"
	else
		rm -rf "$dst/seed"; cp -r "$ROOT/frontend-template/seed" "$dst/seed"; cp "$ROOT/frontend-template/README.md" "$dst/README.md"
	fi
	( cd "$dst" && (bun scripts/seed-manifest.ts >/dev/null 2>&1 || true)
	  if [ -n "$(git status --porcelain)" ]; then
		git add -A && git commit -q -m "Sync from premium-cms-themes ($(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local))"
		echo "$id → $repo: $(git rev-parse --short HEAD)"
		[ "$PUSH" = "--push" ] && git push -q origin HEAD
	  else echo "$id → $repo: in sync"; fi )
done
