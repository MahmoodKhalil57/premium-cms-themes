#!/usr/bin/env bash
#
# Move every theme (and any sibling `file:` plugin a theme consumes) onto the
# latest published @premium-cms/* packages.
#
#   bin/bump-image.sh
#
# For each dependency in the @premium-cms scope the package.json range is
# rewritten to `^<latest on npm>` and the lockfile refreshed, so the next
# `astro build` bundles the new image. The plugin dirs are refreshed too: a
# theme's bundler resolves the plugin's own imports from the plugin's
# node_modules, and a stale nested copy there would silently ship old core code.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

declare -A LATEST
latest() {
	local pkg="$1"
	if [ -z "${LATEST[$pkg]:-}" ]; then
		LATEST[$pkg]="$(npm view "$pkg" version 2>/dev/null || true)"
	fi
	echo "${LATEST[$pkg]}"
}

bump_dir() {
	local dir="$1"
	[ -f "$dir/package.json" ] || return 0
	local pkgs
	pkgs=$(python3 - "$dir/package.json" <<'EOF'
import json, sys
p = json.load(open(sys.argv[1]))
seen = []
for sec in ("dependencies", "devDependencies", "peerDependencies"):
    for k in (p.get(sec) or {}):
        if k.startswith("@premium-cms/") and not (p[sec][k].startswith("file:") or p[sec][k].startswith("workspace:")):
            seen.append(k)
print("\n".join(dict.fromkeys(seen)))
EOF
)
	[ -n "$pkgs" ] || return 0
	local changed=0
	while read -r pkg; do
		[ -n "$pkg" ] || continue
		v="$(latest "$pkg")"
		[ -n "$v" ] || { echo "  $dir: $pkg not on npm — left alone"; continue; }
		if python3 - "$dir/package.json" "$pkg" "$v" <<'EOF'
import json, sys
f, pkg, v = sys.argv[1:4]
p = json.load(open(f))
want = f"^{v}"
changed = False
for sec in ("dependencies", "devDependencies", "peerDependencies"):
    d = p.get(sec) or {}
    if pkg in d and not d[pkg].startswith(("file:", "workspace:")) and d[pkg] != want:
        d[pkg] = want
        changed = True
if changed:
    open(f, "w").write(json.dumps(p, indent="\t") + "\n")
sys.exit(0 if changed else 1)
EOF
		then
			echo "  $dir: $pkg -> ^$v"
			changed=1
		fi
	done <<< "$pkgs"
	# Refresh the lockfile even when the range already covers the new version:
	# a caret range keeps whatever the lock pinned until told otherwise.
	( cd "$dir" && bun update $(echo "$pkgs" | tr '\n' ' ') >/dev/null 2>&1 ) || ( cd "$dir" && bun install >/dev/null 2>&1 )
	[ "$changed" = 1 ] && echo "  $dir: lockfile refreshed" || echo "  $dir: already current (lockfile refreshed)"
}

for t in themes/*/; do
	bump_dir "${t%/}"
	# sibling file: plugins this theme consumes
	python3 - "$t/package.json" <<'EOF' | while read -r rel; do bump_dir "$(cd "$t" && cd "$rel" && pwd)"; done
import json, sys, pathlib
p = json.load(open(sys.argv[1]))
for spec in (p.get("dependencies") or {}).values():
    if spec.startswith("file:"):
        print(spec[len("file:"):])
EOF
done
