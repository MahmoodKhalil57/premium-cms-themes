/**
 * Apply this repo's seed.json to the live backend (run in CI).
 *   node bin/apply-seed.mjs <backend-url> ./seed.json
 * env: SEED_SECRET (matches the backend's provision/seed secret)
 *
 * The backend exposes a seed endpoint that upserts collections, settings and
 * plugin config idempotently. This keeps the repo (frontend + seed) the source
 * of truth: pushing new seed content reseeds the backend on deploy.
 */
import { readFileSync } from "node:fs";
const backend = (process.argv[2] || "").replace(/\/$/, "");
const seedPath = process.argv[3] || "seed.json";
const secret = process.env.SEED_SECRET;
if (!backend || !secret) {
	console.error("usage: apply-seed.mjs <backend-url> <seed.json>  (env SEED_SECRET)");
	process.exit(1);
}
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const res = await fetch(`${backend}/seed-api`, {
	method: "POST",
	headers: { "Content-Type": "application/json", "X-Provision-Secret": secret },
	body: JSON.stringify(seed),
});
if (!res.ok) {
	console.error(`seed failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
	process.exit(1);
}
console.log("✓ seed applied to", backend);
