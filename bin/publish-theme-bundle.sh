#!/usr/bin/env bash
# Build a theme and publish its Worker bundle to the platform-artifacts R2
# bucket, where the marketplace deploy service reads it to provision instances.
#
#   bin/publish-theme-bundle.sh <theme>
#
# Layout written (consumed by packages/marketplace/src/routes/deploy.ts):
#   themes/<theme>/<version>/index.json     BundleIndex
#   themes/<theme>/<version>/server/<mod>   ES module bodies
#   themes/<theme>/<version>/client/<path>  static assets
#   themes/<theme>/latest.json              { "version": "<version>" }
#
# Credentials: CLOUDFLARE_MASTER_ACOUNT_ID + CLOUDFLARE_MASTER_API_TOKEN
# (from ../.env.master), or ARTIFACTS_ACCOUNT_ID + ARTIFACTS_PUBLISH_TOKEN.
set -euo pipefail
THEME="${1:?usage: publish-theme-bundle.sh <theme>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THEME_DIR="$ROOT/themes/$THEME"
[ -d "$THEME_DIR" ] || { echo "no theme at $THEME_DIR"; exit 1; }

# creds
for envf in "$ROOT/../.env.master" "$ROOT/.env"; do
	[ -f "$envf" ] && { set -a; source "$envf"; set +a; }
done
: "${ARTIFACTS_ACCOUNT_ID:=${CLOUDFLARE_MASTER_ACOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}}"
: "${ARTIFACTS_PUBLISH_TOKEN:=${CLOUDFLARE_MASTER_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}}"
export ARTIFACTS_ACCOUNT_ID ARTIFACTS_PUBLISH_TOKEN THEME MARKETPLACE_DEPLOY_KEY

echo "building $THEME…"
( cd "$THEME_DIR" && bunx astro build >/dev/null 2>&1 ) || { echo "astro build failed"; exit 1; }

python3 - "$THEME_DIR" <<'EOF'
import concurrent.futures, hashlib, json, mimetypes, os, sys, time, urllib.parse, urllib.request, urllib.error

theme_dir = sys.argv[1]
theme = os.environ["THEME"]
dist = os.path.join(theme_dir, "dist")
acct = os.environ["ARTIFACTS_ACCOUNT_ID"]
token = os.environ["ARTIFACTS_PUBLISH_TOKEN"]
if not acct or not token:
    sys.exit("missing ARTIFACTS_ACCOUNT_ID / ARTIFACTS_PUBLISH_TOKEN")
version = time.strftime("%Y%m%d-%H%M%S")
base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/platform-artifacts/objects/"

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/javascript", ".mjs")

def put(key, data, ctype="application/octet-stream"):
    last = None
    for attempt in range(4):
        req = urllib.request.Request(base + urllib.parse.quote(key, safe=""), data=data, method="PUT",
            headers={"Authorization": f"Bearer {token}", "Content-Type": ctype, "User-Agent": "premiumcms-theme-publisher/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read()
            return
        except urllib.error.HTTPError as e:
            last = f"{key}: HTTP {e.code} {e.read()[:200]!r}"
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:  # stalled socket, reset, DNS blip — retry
            last = f"{key}: {type(e).__name__}: {e}"
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last)

prefix = f"themes/{theme}/{version}"
modules, uploads = [], []
server_dir = os.path.join(dist, "server")
for dirpath, dirnames, filenames in os.walk(server_dir):
    dirnames[:] = [d for d in dirnames if d != ".prerender"]
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, server_dir)
        if rel in ("wrangler.json", ".dev.vars") or not rel.endswith((".mjs", ".js")):
            continue
        modules.append(rel)
        uploads.append((f"{prefix}/server/{rel}".replace("..", "~~"), open(full, "rb").read(), "application/javascript"))

assets = {}
client_dir = os.path.join(dist, "client")
headers_file = None
for dirpath, _, filenames in os.walk(client_dir):
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = "/" + os.path.relpath(full, client_dir).replace(os.sep, "/")
        data = open(full, "rb").read()
        if rel == "/_headers":
            headers_file = data.decode()
            continue
        ctype = mimetypes.guess_type(fn)[0] or "application/octet-stream"
        assets[rel] = {"hash": hashlib.sha256(data).hexdigest()[:32], "size": len(data), "contentType": ctype}
        uploads.append((f"{prefix}/client{rel}".replace("..", "~~"), data, ctype))

wcfg = json.load(open(os.path.join(server_dir, "wrangler.json")))
index = {
    "version": version,
    "main": wcfg["main"],
    "compatibility_date": wcfg["compatibility_date"],
    "compatibility_flags": wcfg["compatibility_flags"],
    "modules": modules,
    "assets": assets,
    "headersFile": headers_file,
    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
uploads.append((f"{prefix}/index.json", json.dumps(index).encode(), "application/json"))

size_mb = sum(len(u[1]) for u in uploads) // 1024 // 1024
print(f"uploading {len(uploads)} objects ({size_mb} MB) as {theme}@{version}…")
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(lambda u: put(*u), uploads))
put(f"themes/{theme}/latest.json", json.dumps({"version": version}).encode(), "application/json")
print(f"published {theme}@{version} ({len(modules)} modules, {len(assets)} assets)")
EOF

# Keep the bucket small: the deploy service only ever reads `latest`, so
# every version but the newest two is dead weight (hundreds of objects each).
if [ -n "${MARKETPLACE_DEPLOY_KEY:-}" ]; then
	python3 - "$THEME" <<'PY'
import json, os, sys, urllib.request, urllib.parse
theme = sys.argv[1]; acct = os.environ["ARTIFACTS_ACCOUNT_ID"]; tok = os.environ["ARTIFACTS_PUBLISH_TOKEN"]; dk = os.environ["MARKETPLACE_DEPLOY_KEY"]
H = {"Authorization": f"Bearer {tok}", "User-Agent": "premiumcms-theme-publisher/1.0"}
versions, cursor = set(), ""
while True:
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/platform-artifacts/objects?prefix={urllib.parse.quote(f'themes/{theme}/', safe='')}&per_page=1000" + (f"&cursor={cursor}" if cursor else ""), headers=H)))
    for o in d["result"]:
        k = o["key"].split("/")
        if len(k) >= 4: versions.add(k[2])
    ri = d.get("result_info") or {}; cursor = ri.get("cursor") or ""
    if not ri.get("is_truncated") or not cursor: break
for v in sorted(versions)[:-2]:
    req = urllib.request.Request("https://marketplace.premium-cms.com/api/v1/purge-prefix", data=json.dumps({"bucket": "platform-artifacts", "prefix": f"themes/{theme}/{v}/"}).encode(),
        headers={"X-Deploy-Key": dk, "Content-Type": "application/json", "User-Agent": "premiumcms-theme-publisher/1.0"}, method="POST")
    print(f"pruned {theme}@{v}: {json.load(urllib.request.urlopen(req)).get('deleted')} objects")
PY
fi
