#!/usr/bin/env node
/**
 * `check:cf` — the static checks a pull request must pass before it is built:
 *   1. every JSON file under seed/ and content/ parses;
 *   2. `astro check` (TypeScript + Astro diagnostics) when it is installed.
 * Exit code 1 on the first failure; output is what the PR comment shows.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let failed = 0;
function walk(dir) {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith(".json")) {
			try {
				JSON.parse(readFileSync(p, "utf8"));
			} catch (e) {
				failed++;
				console.error(`✗ ${p}: ${e.message}`);
			}
		}
	}
}
walk("seed");
walk("content");
console.log(failed ? `✗ ${failed} invalid JSON file(s)` : "✓ seed/ and content/ JSON is valid");

if (existsSync("node_modules/@astrojs/check")) {
	const r = spawnSync("npx", ["astro", "check", "--minimumSeverity", "error"], {
		stdio: "inherit",
	});
	if (r.status !== 0) failed++;
} else {
	console.log("· astro check skipped (@astrojs/check is not installed)");
}
process.exit(failed ? 1 : 0);
