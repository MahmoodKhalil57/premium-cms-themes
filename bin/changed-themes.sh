#!/usr/bin/env bash
#
# Print the themes that changed between two commits, as a JSON array.
#
#   bin/changed-themes.sh [<base-ref> [<head-ref>]]     # default: HEAD~1 HEAD
#
# Themes are independent deploy units: each is its own Astro site and its own
# Worker. A push that touches themes/apex must redeploy apex and nothing else —
# with hundreds of themes on one image, rebuilding all of them on every change
# is the thing this exists to prevent.
#
# Repo-level files (bin/, README, root config) deliberately do NOT trigger any
# deploy: they cannot change what a theme's Worker serves. Only themes/<slug>/**
# does. To force one, use the workflow's manual dispatch input.
#
# A deleted theme is skipped — there is nothing left to build.
set -euo pipefail

BASE="${1:-HEAD~1}"
HEAD_REF="${2:-HEAD}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

all_themes() {
	for d in themes/*/; do
		[ -f "$d/package.json" ] && basename "$d"
	done
}

# An unusable base (first push, force-push, shallow clone) must not silently
# deploy nothing — fall back to every theme and say so on stderr.
if ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
	echo "base ref '$BASE' not found — falling back to all themes" >&2
	all_themes | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))"
	exit 0
fi

git diff --name-only "$BASE" "$HEAD_REF" -- 'themes/*' \
	| awk -F/ 'NF>=2 && $1=="themes" {print $2}' \
	| sort -u \
	| while read -r slug; do
		# Only emit themes that still exist and are buildable.
		[ -n "$slug" ] && [ -f "themes/$slug/package.json" ] && echo "$slug"
	done \
	| python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))"
