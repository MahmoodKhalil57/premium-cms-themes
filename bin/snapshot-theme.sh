#!/usr/bin/env bash
# Snapshot a live project's plugin setup into a theme's seed:
#   bin/snapshot-theme.sh <project-id> <theme-id> [plugin,plugin,…]
#
# Fetches each plugin's config/export through the apex platform plugin
# (fleet/export → child /platform/config-export → in-process config/export)
# and writes the result into themes/<theme-id>/seed/seed.json under `plugins`.
# The plugin list defaults to the theme's premiumcms.plugins.
#
# Exports are seed-shaped and idempotent: non-secret settings plus re-create
# calls (services reference staff by name; forms/create uses ignoreErrors).
# Never exported: payment/API keys, webhook secrets, staff PINs, linked user
# ids, notify emails, runtime data (orders, bookings, submissions, shifts).
# REVIEW THE GIT DIFF before committing — the snapshot is authoring input,
# the committed seed stays the source of truth.
#
# env: DEPLOY_KEY (required; the platform's fleet key), PLATFORM_URL (default https://premium-cms.com)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:?project id}"; THEME="${2:?theme id}"; ONLY="${3:-}"
URL="${PLATFORM_URL:-https://premium-cms.com}/_emdash/api/plugins/premium-platform/fleet/export"
[ -n "${DEPLOY_KEY:-}" ] || { echo "DEPLOY_KEY is not set"; exit 1; }
SEED="$ROOT/themes/$THEME/seed/seed.json"
[ -f "$SEED" ] || { echo "no seed at themes/$THEME/seed/seed.json"; exit 1; }
if [ -n "$ONLY" ]; then PLUGINS="$ONLY"; else
	PLUGINS="$(python3 -c "import json,sys;print(','.join((json.load(open(sys.argv[1])).get('premiumcms') or {}).get('plugins',[])))" "$ROOT/themes/$THEME/theme.json")"
fi
[ -n "$PLUGINS" ] || { echo "theme lists no plugins (and none given)"; exit 1; }
BODY="$(python3 -c "import json,os,sys;print(json.dumps({'key': os.environ['DEPLOY_KEY'], 'project': sys.argv[1], 'plugins': sys.argv[2].split(',')}))" "$PROJECT" "$PLUGINS")"
OUT="$(mktemp)"
curl -sS -m 120 -X POST "$URL" -H "Content-Type: application/json" -d "$BODY" > "$OUT"
python3 - "$OUT" "$SEED" <<'PY'
import json, sys
out, seedp = sys.argv[1:3]
r = json.load(open(out))
if not r.get("success"):
    raise SystemExit(f"export failed: {r.get('error')}")
exported = r["data"]["plugins"]
raw = open(seedp).read()
seed = json.loads(raw)
plugins = seed.get("plugins") or {}
for pid, res in exported.items():
    if not res.get("ok"):
        print(f"  !! {pid}: {res.get('error')} — left unchanged")
        continue
    frag = {}
    if res.get("settings"):
        frag["settings"] = res["settings"]
    if res.get("calls"):
        frag["calls"] = res["calls"]
    if frag:
        plugins[pid] = frag
        print(f"  ok {pid}: {len(res.get('settings') or {})} settings, {len(res.get('calls') or [])} calls")
    else:
        print(f"  -- {pid}: nothing to export — left unchanged")
seed["plugins"] = plugins
indent = "\t" if "\n\t" in raw[:200] else "  "
open(seedp, "w").write(json.dumps(seed, indent=indent, ensure_ascii=False) + "\n")
PY
echo "wrote themes/$THEME/seed/seed.json — review with: git -C $ROOT diff themes/$THEME/seed/seed.json"
