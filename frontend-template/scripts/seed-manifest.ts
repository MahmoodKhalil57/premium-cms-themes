/**
 * Writes seed/manifest.json — the list of seed files — so the platform can
 * apply this theme's seed to a site it hosts without listing the repository
 * through the GitHub API (which is rate-limited). Run after adding or
 * removing seed files:  bun scripts/seed-manifest.ts
 */
import { readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../seed/", import.meta.url).pathname;
const files: string[] = [];
const walk = async (dir: string) => {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) await walk(p);
		else if (entry.name.endsWith(".json") && entry.name !== "manifest.json" && !p.includes("/schemas/")) files.push("seed/" + relative(root, p));
	}
};
await walk(root);
files.sort();
await writeFile(join(root, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), files }, null, 2) + "\n");
console.log(`seed/manifest.json: ${files.length} file(s)`);
