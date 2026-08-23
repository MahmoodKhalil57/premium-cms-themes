#!/usr/bin/env bash
# The fast theme loop: apply a theme's LOCAL seed straight to its live demo —
# no template-repo sync, no CI, no deployment (the frontend template is served
# by the platform already; only db-backed content changes).
#
#   bin/dev-theme.sh <theme-id> [project-id] [--watch] [--full]
#
#   theme-id     themes/<id>/seed to apply (premiumcms = the apex site itself)
#   project-id   target project (default: the theme's demo, same id)
#   --watch      keep watching the seed dir and re-apply on change
#   --full       send everything (default sends only files changed since the
#                last successful apply to this project — seconds, not ~a minute)
#
# Deltas ride on seed-api's update-on-conflict semantics: a partial seed only
# touches what it contains. Deleting a seed file does NOT retire the entry on
# the site — use `retire` in seed.json, or push and let the full reseed run.
# Composition mirrors frontend-template/scripts/apply-seed.ts: sections/*.json
# merge into `sections`, content/<collection>/<slug>.json into
# content[collection] (slug/id defaulted from the filename), $schema stripped,
# {"$env": "NAME"} resolved from the environment.
#
# Auth: apex fleet/seed with DEPLOY_KEY — env var, else the 0600 cache
# ~/apps/premiumcms/.deploy-key, else read once from apex D1 (credentials in
# ~/apps/premiumcms/.env.apex) and cached; never printed. The premiumcms theme
# applies straight to premium-cms.com with PROVISION_SECRET from
# ~/apps/premiumcms/apex/.env.
#
# This updates ONLY the target project. Other projects on the theme, the
# marketplace listing and the template repo update when you commit + push
# (CI: template-repo sync, listing publish, fleet reseed) — so finish with a
# push, or your live demo and the shipped theme drift apart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THEME="${1:?theme id}"; shift
PROJECT="$THEME"; WATCH=0; FULL=0
for a in "$@"; do case "$a" in --watch) WATCH=1 ;; --full) FULL=1 ;; *) PROJECT="$a" ;; esac; done
SEED_DIR="$ROOT/themes/$THEME/seed"
[ -f "$SEED_DIR/seed.json" ] || { echo "no seed at themes/$THEME/seed/seed.json"; exit 1; }
PLATFORM_URL="${PLATFORM_URL:-https://premium-cms.com}"
CACHE_DIR="$HOME/apps/premiumcms/.dev-theme-cache"; mkdir -p "$CACHE_DIR"
STATE="$CACHE_DIR/$PROJECT-$THEME.json"

KEY_CACHE="$HOME/apps/premiumcms/.deploy-key"
load_deploy_key() {
	[ -n "${DEPLOY_KEY:-}" ] && return 0
	if [ -s "$KEY_CACHE" ]; then DEPLOY_KEY="$(cat "$KEY_CACHE")"; export DEPLOY_KEY; return 0; fi
	DEPLOY_KEY="$(set -a; . ~/apps/premiumcms/.env.apex 2>/dev/null; set +a; CLOUDFLARE_API_TOKEN="$APEX_CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$APEX_CLOUDFLARE_ACCOUNT_ID" bunx wrangler d1 execute apex-db --remote --config ~/apps/premiumcms-repos/premium-cms-image/platform/instances/apex/wrangler.jsonc --command "SELECT value FROM options WHERE name='plugin:premium-platform:settings:DEPLOY_KEY'" --json 2>/dev/null | python3 -c "import json,sys;out=json.load(sys.stdin);print(json.loads(out[0]['results'][0]['value']),end='')")"
	[ -n "$DEPLOY_KEY" ] || { echo "DEPLOY_KEY: not in env, no cache, and apex D1 read failed"; return 1; }
	export DEPLOY_KEY
	(umask 077 && printf '%s' "$DEPLOY_KEY" > "$KEY_CACHE") || true
}

# compose <doc-out> <newstate-out> — delta unless FULL=1 or no prior state.
# Prints a one-line summary; exits 3 when there is nothing to send.
compose() {
	python3 - "$SEED_DIR" "$1" "$2" "$STATE" "$FULL" <<'PY'
import glob, hashlib, json, os, sys
d, doc_out, state_out, state_path, full = sys.argv[1:6]
full = full == "1"
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()
prev = {}
if not full and os.path.exists(state_path):
    try: prev = json.load(open(state_path))
    except Exception: prev = {}
files = {os.path.relpath(p, d): sha(p) for p in
         [f"{d}/seed.json"] + sorted(glob.glob(f"{d}/sections/*.json")) + sorted(glob.glob(f"{d}/content/*/*.json"))}
changed = {rel for rel, h in files.items() if prev.get(rel) != h}
root_changed = "seed.json" in changed or not prev
seed = json.load(open(f"{d}/seed.json"))
if not root_changed:
    # minimal envelope: update-on-conflict only touches what the doc contains
    seed = {"version": seed.get("version", "1"), "meta": {"name": "dev-theme delta"}}
sections = list(seed.get("sections") or []) if root_changed else []
for p in sorted(glob.glob(f"{d}/sections/*.json")):
    rel = os.path.relpath(p, d)
    if root_changed or rel in changed:
        s = json.load(open(p)); s.setdefault("slug", os.path.basename(p)[:-5]); sections.append(s)
if sections: seed["sections"] = sections
content = dict(seed.get("content") or {}) if root_changed else {}
sent = 0
for cdir in sorted(glob.glob(f"{d}/content/*/")):
    coll = os.path.basename(cdir.rstrip("/"))
    for p in sorted(glob.glob(f"{cdir}*.json")):
        rel = os.path.relpath(p, d)
        if not (root_changed or rel in changed): continue
        e = json.load(open(p)); e.setdefault("slug", os.path.basename(p)[:-5]); e.setdefault("id", f"{coll}-{e['slug']}")
        content.setdefault(coll, []).append(e); sent += 1
if content: seed["content"] = content
def resolve(n, path="$"):
    if isinstance(n, list): return [resolve(x, f"{path}[{i}]") for i, x in enumerate(n)]
    if isinstance(n, dict):
        if set(n) == {"$env"}:
            v = os.environ.get(n["$env"])
            if v is None: raise SystemExit(f"seed {path} references $env {n['$env']!r}, which is not set")
            return v
        return {k: resolve(v, f"{path}.{k}") for k, v in n.items() if k != "$schema"}
    return n
if not root_changed and not changed:
    print("nothing changed since the last apply (use --full to force)"); sys.exit(3)
json.dump(resolve(seed), open(doc_out, "w"))
json.dump(files, open(state_out, "w"))
kind = "full" if root_changed else f"delta ({len(changed)} file(s))"
print(f"composing {kind}: {sent} content entries, {len(sections)} sections" + (", root doc" if root_changed else ""))
PY
}

apply() {
	local doc out newstate rc=0
	doc="$(mktemp)"; out="$(mktemp)"; newstate="$(mktemp)"
	compose "$doc" "$newstate" || { rc=$?; rm -f "$doc" "$out" "$newstate"; [ "$rc" = 3 ] && return 0 || return "$rc"; }
	if [ "$THEME" = "premiumcms" ] || [ "$PROJECT" = "apex" ]; then
		local secret
		secret="$(grep -m1 '^PROVISION_SECRET=' ~/apps/premiumcms/apex/.env | cut -d= -f2-)"
		[ -n "$secret" ] || { echo "PROVISION_SECRET not found in ~/apps/premiumcms/apex/.env"; rm -f "$doc" "$out" "$newstate"; return 1; }
		curl -sS -m 180 -X POST "$PLATFORM_URL/seed-api" -H "Content-Type: application/json" -H "x-provision-secret: $secret" --data-binary @"$doc" > "$out" \
			&& python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print('applied to apex:',json.dumps(r.get('result'))[:220]) if r.get('ok') else sys.exit('FAILED: '+str(r.get('error')))" "$out" || rc=1
	else
		load_deploy_key || { rm -f "$doc" "$out" "$newstate"; return 1; }
		python3 -c "import json,os,sys;json.dump({'key':os.environ['DEPLOY_KEY'],'project':sys.argv[2],'seed':json.load(open(sys.argv[1]))},open(sys.argv[3],'w'))" "$doc" "$PROJECT" "$doc.body"
		curl -sS -m 180 -X POST "$PLATFORM_URL/_emdash/api/plugins/premium-platform/fleet/seed" -H "Content-Type: application/json" --data-binary @"$doc.body" > "$out" \
			&& python3 -c "import json,sys;r=json.load(open(sys.argv[1]));d=r.get('data') or {};print('applied to',d.get('hostname'),json.dumps(d.get('result'))[:220]) if r.get('success') else sys.exit('FAILED: '+json.dumps(r.get('error'))[:300])" "$out" || rc=1
		rm -f "$doc.body"
	fi
	[ "$rc" = 0 ] && mv "$newstate" "$STATE" || rm -f "$newstate"
	rm -f "$doc" "$out"; return "$rc"
}

apply
if [ "$WATCH" = 1 ]; then
	echo "watching themes/$THEME/seed — Ctrl-C to stop"
	last="$(find "$SEED_DIR" -type f -name '*.json' -exec stat -c '%Y %n' {} + | sort | md5sum)"
	while sleep 2; do
		cur="$(find "$SEED_DIR" -type f -name '*.json' -exec stat -c '%Y %n' {} + | sort | md5sum)"
		if [ "$cur" != "$last" ]; then last="$cur"; echo "— change detected $(date +%H:%M:%S)"; apply || true; fi
	done
fi
