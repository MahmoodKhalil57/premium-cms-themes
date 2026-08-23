#!/usr/bin/env bash
# The fast theme loop: apply a theme's LOCAL seed straight to its live demo —
# content, sections, menus, plugin settings and calls land in seconds, no
# template-repo sync, no CI, no deployment (the frontend template is served by
# the platform already; only db-backed content changes).
#
#   bin/dev-theme.sh <theme-id> [project-id] [--watch]
#
#   theme-id     themes/<id>/seed to apply (premiumcms = the apex site itself)
#   project-id   target project (default: the theme's demo, same id)
#   --watch      keep watching the seed dir and re-apply on change
#
# Composition mirrors frontend-template/scripts/apply-seed.ts: sections/*.json
# merge into `sections`, content/<collection>/<slug>.json into
# content[collection] (slug/id defaulted from the filename), $schema stripped,
# {"$env": "NAME"} resolved from the environment.
#
# Auth: DEPLOY_KEY env (the platform fleet key) → apex fleet/seed → child
# /seed-api. If DEPLOY_KEY is unset, it is read from apex D1 via the
# credentials in ~/apps/premiumcms/.env.apex (never printed). The premiumcms
# theme applies straight to premium-cms.com with PROVISION_SECRET from
# ~/apps/premiumcms/apex/.env.
#
# This updates ONLY the target project. Other projects on the theme, the
# marketplace listing and the template repo update when you commit + push
# (CI: template-repo sync, listing publish, fleet reseed) — so finish with a
# push, or your live demo and the shipped theme drift apart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THEME="${1:?theme id}"; shift
PROJECT="$THEME"; WATCH=0
for a in "$@"; do case "$a" in --watch) WATCH=1 ;; *) PROJECT="$a" ;; esac; done
SEED_DIR="$ROOT/themes/$THEME/seed"
[ -f "$SEED_DIR/seed.json" ] || { echo "no seed at themes/$THEME/seed/seed.json"; exit 1; }
PLATFORM_URL="${PLATFORM_URL:-https://premium-cms.com}"

compose() {
	python3 - "$SEED_DIR" <<'PY'
import glob, json, os, sys
d = sys.argv[1]
seed = json.load(open(f"{d}/seed.json"))
sections = list(seed.get("sections") or [])
for p in sorted(glob.glob(f"{d}/sections/*.json")):
    s = json.load(open(p)); s.setdefault("slug", os.path.basename(p)[:-5]); sections.append(s)
if sections: seed["sections"] = sections
content = dict(seed.get("content") or {})
for cdir in sorted(glob.glob(f"{d}/content/*/")):
    coll = os.path.basename(cdir.rstrip("/"))
    for p in sorted(glob.glob(f"{cdir}*.json")):
        e = json.load(open(p))
        e.setdefault("slug", os.path.basename(p)[:-5]); e.setdefault("id", f"{coll}-{e['slug']}")
        content.setdefault(coll, []).append(e)
seed["content"] = content
def resolve(n, path="$"):
    if isinstance(n, list): return [resolve(x, f"{path}[{i}]") for i, x in enumerate(n)]
    if isinstance(n, dict):
        if set(n) == {"$env"}:
            v = os.environ.get(n["$env"])
            if v is None: raise SystemExit(f"seed {path} references $env {n['$env']!r}, which is not set")
            return v
        return {k: resolve(v, f"{path}.{k}") for k, v in n.items() if k != "$schema"}
    return n
json.dump(resolve(seed), sys.stdout)
PY
}

apply() {
	local doc rc out
	doc="$(mktemp)"; out="$(mktemp)"
	compose > "$doc"
	if [ "$THEME" = "premiumcms" ] || [ "$PROJECT" = "apex" ]; then
		local secret
		secret="$(grep -m1 '^PROVISION_SECRET=' ~/apps/premiumcms/apex/.env | cut -d= -f2-)"
		[ -n "$secret" ] || { echo "PROVISION_SECRET not found in ~/apps/premiumcms/apex/.env"; return 1; }
		curl -sS -m 120 -X POST "$PLATFORM_URL/seed-api" -H "Content-Type: application/json" -H "x-provision-secret: $secret" --data-binary @"$doc" > "$out"
		python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print('applied to apex:',json.dumps(r.get('result'))[:300]) if r.get('ok') else sys.exit('FAILED: '+str(r.get('error')))" "$out"
	else
		if [ -z "${DEPLOY_KEY:-}" ]; then
			DEPLOY_KEY="$(set -a; . ~/apps/premiumcms/.env.apex 2>/dev/null; set +a; CLOUDFLARE_API_TOKEN="$APEX_CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$APEX_CLOUDFLARE_ACCOUNT_ID" bunx wrangler d1 execute apex-db --remote --config ~/apps/premiumcms-repos/premium-cms-image/platform/instances/apex/wrangler.jsonc --command "SELECT value FROM options WHERE name='plugin:premium-platform:settings:DEPLOY_KEY'" --json 2>/dev/null | python3 -c "import json,sys;out=json.load(sys.stdin);print(json.loads(out[0]['results'][0]['value']),end='')")"
			export DEPLOY_KEY
			[ -n "$DEPLOY_KEY" ] || { echo "DEPLOY_KEY is not set and could not be read from apex"; return 1; }
		fi
		python3 -c "import json,os,sys;json.dump({'key':os.environ['DEPLOY_KEY'],'project':sys.argv[2],'seed':json.load(open(sys.argv[1]))},open(sys.argv[3],'w'))" "$doc" "$PROJECT" "$doc.body"
		curl -sS -m 120 -X POST "$PLATFORM_URL/_emdash/api/plugins/premium-platform/fleet/seed" -H "Content-Type: application/json" --data-binary @"$doc.body" > "$out"
		rm -f "$doc.body"
		python3 -c "import json,sys;r=json.load(open(sys.argv[1]));d=r.get('data') or {};print('applied to',d.get('hostname'),json.dumps(d.get('result'))[:300]) if r.get('success') else sys.exit('FAILED: '+json.dumps(r.get('error'))[:300])" "$out"
	fi
	rc=$?; rm -f "$doc" "$out"; return $rc
}

apply
if [ "$WATCH" = 1 ]; then
	echo "watching themes/$THEME/seed — Ctrl-C to stop"
	last="$(find "$SEED_DIR" -type f -name '*.json' -newer /dev/null -exec stat -c '%Y %n' {} + | sort | md5sum)"
	while sleep 3; do
		cur="$(find "$SEED_DIR" -type f -name '*.json' -exec stat -c '%Y %n' {} + | sort | md5sum)"
		if [ "$cur" != "$last" ]; then last="$cur"; echo "— change detected $(date +%H:%M:%S)"; apply || true; fi
	done
fi
