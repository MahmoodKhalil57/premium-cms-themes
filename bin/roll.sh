#!/usr/bin/env bash
#
# Post-deploy step: bring the whole instance tree onto what was just shipped.
#
#   bin/roll.sh [steps]        # steps: comma-separated, default bundle,plugins,seed,frontend
#
# Runs against the root control plane (master): re-applies master's own bundled
# seed, then asks its projects plugin to `roll` — redeploy every child from the
# `latest` golden bundle, apply plugin updates, reseed, re-sync the frontend
# template — and cascade the same request down the tree, each parent with its
# own credentials. Any base repo's release ends by calling this; the frontend
# template repos call the same route from their own Actions workflow.
#
# Env: MASTER_PLATFORM_TOKEN (an admin API token on master), optionally
# MASTER_URL (default https://master.premium-cms.com).
set -euo pipefail
STEPS="${1:-${ROLL_STEPS:-bundle,plugins,seed,frontend}}"
MASTER="${MASTER_URL:-https://master.premium-cms.com}"
: "${MASTER_PLATFORM_TOKEN:?MASTER_PLATFORM_TOKEN is not set — cannot roll the instances}"

STEPS_JSON=$(python3 -c "import json,sys; print(json.dumps([s.strip() for s in sys.argv[1].split(',') if s.strip()]))" "$STEPS")
HDR=(-H "Authorization: Bearer $MASTER_PLATFORM_TOKEN" -H "X-EmDash-Request: 1" -H "Content-Type: application/json" -A "premiumcms-release/1.0")

if echo "$STEPS" | grep -q seed; then
	echo "::: reseed master"
	curl -sS --max-time 300 -X POST "$MASTER/_emdash/api/settings/reseed" "${HDR[@]}" -d '{}' \
		| python3 -c "import json,sys; d=json.load(sys.stdin).get('data',{}); print('  ' + ', '.join(f'{k}: +{v.get(\"created\",0)}/~{v.get(\"updated\",0)}' for k,v in d.items() if isinstance(v,dict) and (v.get('created') or v.get('updated'))) or '  nothing to apply')"
fi

echo "::: roll $STEPS_JSON"
OUT=$(curl -sS --max-time 3000 -X POST "$MASTER/_emdash/api/plugins/premiumcms-projects/roll" "${HDR[@]}" \
	-d "{\"steps\": $STEPS_JSON, \"cascade\": true}")
ROLL_OUTPUT="$OUT" python3 - <<'PY'
import json, os, sys
raw = os.environ["ROLL_OUTPUT"]
try:
    d = json.loads(raw).get("data", {})
except Exception:
    sys.exit("unexpected response: " + raw[:300])
def walk(rs, depth=1):
    for r in rs:
        state = "ok" if r["ok"] else "FAILED"
        steps = ", ".join(f"{k}={v}" for k, v in r["steps"].items())
        print("  " * depth + f"{r['label']} ({r['project']}): {state} {steps}")
        c = r.get("children")
        if isinstance(c, list): walk(c, depth + 1)
        elif isinstance(c, dict): print("  " * (depth + 1) + "children skipped: " + c.get("skipped", ""))
if d.get("skipped"): print("  " + d["skipped"])
walk(d.get("results", []))
sys.exit(0 if d.get("success") else 1)
PY
