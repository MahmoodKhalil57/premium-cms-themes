#!/usr/bin/env bash
# Publish theme listings (theme.json + thumbnail + screenshots) to the marketplace
# bucket and rebuild marketplace/themes/index.json from the repo.
#   bin/publish-theme.sh            all themes/*      bin/publish-theme.sh bistro
# env: CF_ACCOUNT_ID, ARTIFACTS_PUBLISH_TOKEN, PLUGINS_SRC (plugins repo checkout, for the versions stamped into premiumcms.template / requires)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" "$@" <<'PY'
import glob, json, os, sys, urllib.parse, urllib.request
root, ids = sys.argv[1], sys.argv[2:]
acct = os.environ["CF_ACCOUNT_ID"]; token = os.environ["ARTIFACTS_PUBLISH_TOKEN"]
base = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/platform-artifacts/objects/"
HDR = {"Authorization": f"Bearer {token}", "User-Agent": "premiumcms-publisher/1.0"}
def r2_put(key, data, ctype):
    req = urllib.request.Request(base + urllib.parse.quote(key, safe=""), data=data, method="PUT", headers={**HDR, "Content-Type": ctype})
    with urllib.request.urlopen(req) as r: r.read()
def r2_get(key):
    req = urllib.request.Request(base + urllib.parse.quote(key, safe=""), headers=HDR)
    try:
        with urllib.request.urlopen(req) as r: return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404: return None
        raise
template_version = json.load(open(os.path.join(root, "frontend-template", "package.json")))["version"]
psrc = os.environ.get("PLUGINS_SRC") or os.path.join(root, "..", "premium-cms-plugins")
plugin_versions = {}
for mf in glob.glob(os.path.join(psrc, "plugins", "*", "manifest.json")):
    m = json.load(open(mf)); plugin_versions[m["id"]] = m["version"]
dirs = [os.path.join(root, "themes", i) for i in ids] if ids else sorted(glob.glob(os.path.join(root, "themes", "*")))
raw = r2_get("marketplace/themes/index.json"); index = json.loads(raw) if raw else {"themes": []}
entries = {t["id"]: t for t in index.get("themes", [])}
for d in dirs:
    tj = os.path.join(d, "theme.json")
    if not os.path.exists(tj): continue
    theme = json.load(open(tj)); tid = theme["id"]
    # Versions the listing was published against: the shared template and each plugin frontend the theme uses.
    pc = theme.setdefault("premiumcms", {})
    pc["template"] = template_version
    pc["requires"] = {pid: plugin_versions[pid] for pid in pc.get("plugins", []) if pid in plugin_versions}
    json.dump(theme, open(tj, "w"), indent="\t", ensure_ascii=False); open(tj, "a").write("\n")
    assert tid == os.path.basename(d), f"{d}: id must equal the folder name"
    thumb = os.path.join(d, "thumbnail.png"); theme["hasThumbnail"] = os.path.exists(thumb)
    if theme["hasThumbnail"]: r2_put(f"marketplace/themes/{tid}/thumbnail.png", open(thumb, "rb").read(), "image/png")
    shots = sorted(glob.glob(os.path.join(d, "screenshot-*.png")))
    for i, p in enumerate(shots, 1): r2_put(f"marketplace/themes/{tid}/screenshot-{i}.png", open(p, "rb").read(), "image/png")
    theme["screenshots"] = len(shots)
    entries[tid] = theme
    print(f"published theme {tid}: thumbnail={theme['hasThumbnail']} screenshots={len(shots)}")
if not ids:
    repo_ids = {os.path.basename(d) for d in dirs if os.path.exists(os.path.join(d, "theme.json"))}
    for gone in [t for t in entries if t not in repo_ids]:
        del entries[gone]; print(f"pruned theme {gone}")
index["themes"] = sorted(entries.values(), key=lambda t: t["id"])
r2_put("marketplace/themes/index.json", json.dumps(index, indent=1).encode(), "application/json")
print(f"{len(index['themes'])} theme(s) in catalogue")
PY
