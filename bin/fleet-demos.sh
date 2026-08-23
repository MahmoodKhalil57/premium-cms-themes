#!/usr/bin/env bash
# Reconcile the platform's demo projects with demos.json (create / theme / destroy).
# env: PLATFORM_URL (default https://premium-cms.com), DEPLOY_KEY
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${PLATFORM_URL:-https://premium-cms.com}/_emdash/api/plugins/premium-platform/fleet/demos"
[ -n "${DEPLOY_KEY:-}" ] || { echo "DEPLOY_KEY is not set"; exit 1; }
failed=0; rounds=0
while :; do
  body=$(python3 -c "import json,os,sys; d=json.load(open(sys.argv[1])); print(json.dumps({'key': os.environ['DEPLOY_KEY'], 'demos': d['demos'], 'limit': 1}))" "$ROOT/demos.json")
  attempt=0
  while :; do
    res=$(curl -sS --max-time 300 -X POST "$URL" -H "Content-Type: application/json" -H "X-EmDash-Request: 1" -d "$body")
    if echo "$res" | grep -qE "wall-time limit|Authentication required|Plugin route not found|Plugin not enabled" && [ $attempt -lt 4 ]; then attempt=$((attempt+1)); echo "  transient platform error — retrying ($attempt)"; sleep 15; continue; fi
    break
  done
  python3 -c "
import json,sys
d=json.loads(sys.argv[1]); data=d.get('data') or {}
if not d.get('success', True) or 'error' in d: print('ERROR', (d.get('error') or {}).get('message', d)); sys.exit(2)
for x in data.get('done', []): print('  ok    ', x['id'], x['step'], json.dumps(x.get('result'))[:140] if x.get('result') is not None else '')
for x in data.get('failed', []): print('  FAILED', x['id'], x['step'], x['error'][:200])
print('  planned:', ', '.join(data.get('planned', [])) or 'nothing')
open('/tmp/demos-planned','w').write(str(len(data.get('planned', []))))
open('/tmp/demos-done','w').write(str(len(data.get('done', []))))
open('/tmp/demos-failed','w').write(str(len(data.get('failed', []))))
" "$res"
  failed=$((failed + $(cat /tmp/demos-failed)))
  rounds=$((rounds+1))
  # stop when nothing is planned, or when a round made no progress (only failures)
  [ "$(cat /tmp/demos-planned)" = "0" ] && break
  [ "$(cat /tmp/demos-done)" = "0" ] && break
  [ $rounds -ge 60 ] && { echo "giving up after $rounds rounds"; break; }
done
echo "demo reconcile finished; failed steps: $failed"
[ "$failed" = "0" ]
