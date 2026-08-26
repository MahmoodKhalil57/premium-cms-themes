#!/usr/bin/env bash
#
# Build any sibling plugins a theme consumes through a `file:` dependency.
#
#   bin/build-plugin-deps.sh <theme-dir>
#
# The descriptor a theme imports from such a plugin points at the plugin's
# `dist/`, which is gitignored — so on a fresh checkout the plugin is present
# as source but has no build output, and the theme's build fails with a module
# resolution error that says nothing about the real cause.
#
# Exits 0 when a theme has no local plugin dependencies, which is the norm:
# plugins are meant to reach sites through the registry, not through the
# theme's build. This exists for the ones that have not moved over yet.
set -euo pipefail

THEME_DIR="${1:-.}"
cd "$THEME_DIR"

mapfile -t DIRS < <(python3 -c '
import json, pathlib, sys
deps = json.loads(pathlib.Path("package.json").read_text()).get("dependencies", {})
for spec in deps.values():
    if spec.startswith("file:"):
        print(spec[len("file:"):])
')

if [ ${#DIRS[@]} -eq 0 ]; then
	echo "  no local plugin dependencies"
	exit 0
fi

for d in "${DIRS[@]}"; do
	if [ ! -d "$d" ]; then
		echo "::error::local plugin dependency not found at $d (relative to $THEME_DIR)"
		echo "The plugins repository must be checked out as a sibling of this one."
		exit 1
	fi
	echo "  building plugin: $d"
	( cd "$d" && bun install >/dev/null 2>&1 && npx emdash-plugin build >/dev/null )
	echo "    built"
done
