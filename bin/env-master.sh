#!/usr/bin/env bash
# Sourced by the release scripts: outside a Workers Build, load the workspace's
# ../.env.master (kept out of git) and map the platform account's credentials
# onto the names wrangler and the roll script read. Explicit env still wins.
_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.master"
if [ -z "${WORKERS_CI:-}" ] && [ -f "$_ENV" ]; then
	set -a
	# shellcheck source=/dev/null
	source "$_ENV"
	set +a
	export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CLOUDFLARE_MASTER_API_TOKEN:-}}"
	export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CLOUDFLARE_MASTER_ACOUNT_ID:-}}"
fi
unset _ENV
