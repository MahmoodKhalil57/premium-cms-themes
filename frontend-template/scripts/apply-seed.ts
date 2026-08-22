/**
 * Compose and apply this site's content seed. Runs in the deploy workflow
 * BEFORE the build, so the static frontend pre-renders against the content
 * it ships with. Also runnable locally:
 *
 *   CMS_SEED_TOKEN=... bun scripts/apply-seed.ts
 *
 * The seed is split across files so it stays reviewable as it grows:
 *
 *   seed/seed.json                     root: meta, settings (+ anything inline)
 *   seed/content/<collection>/<slug>.json  one content entry per file
 *   seed/schemas/*.schema.json         JSON Schemas the files' $schema point at
 *
 * Composition: entry files are read in filename order and appended to the
 * root's content[<collection>]. An entry file may omit `slug` (defaults to
 * its filename) and `id` (defaults to <collection>-<slug>). `$schema` keys
 * are stripped before applying.
 *
 * Applied with update-on-conflict (matched by slug) — a living migration.
 * Sensitive values stay out of the repo: any {"$env": "NAME"} value is
 * replaced with the environment variable NAME at apply time, and the
 * endpoint is authenticated with the CMS_SEED_TOKEN env var.
 */
import { readdir } from "node:fs/promises";
import { CMS_URL } from "../src/config";

const seedDir = new URL("../seed/", import.meta.url);
const rootFile = Bun.file(new URL("seed.json", seedDir));
if (!(await rootFile.exists())) {
	console.log("apply-seed: no seed/seed.json — nothing to apply.");
	process.exit(0);
}
const token = process.env.CMS_SEED_TOKEN?.trim();
if (!token) {
	console.log("apply-seed: CMS_SEED_TOKEN is not set — skipping seed apply.");
	process.exit(0);
}
if (!CMS_URL) {
	console.log("apply-seed: CMS_URL is not configured in src/config.ts — skipping seed apply.");
	process.exit(0);
}

/* ---- compose: root + one-file-per-entry content ---- */

const seed = (await rootFile.json()) as Record<string, unknown>;
const content: Record<string, unknown[]> = { ...((seed.content as Record<string, unknown[]>) ?? {}) };

// Layout sections (reusable designer-editable blocks) live one-per-file in
// seed/content-free seed/sections/<slug>.json; merged into root `sections`.
const sections: unknown[] = Array.isArray(seed.sections) ? [...(seed.sections as unknown[])] : [];
const sectionFiles = (await readdir(new URL("sections/", seedDir)).catch(() => []) as string[])
	.filter((f) => f.endsWith(".json"))
	.sort();
for (const file of sectionFiles) {
	const section = (await Bun.file(new URL(`sections/${file}`, seedDir)).json()) as Record<string, unknown>;
	section.slug ??= file.replace(/\.json$/, "");
	sections.push(section);
}
if (sections.length > 0) seed.sections = sections;

let fromFiles = 0;
const collections = await readdir(new URL("content/", seedDir), { withFileTypes: true }).catch(() => []);
for (const dir of collections) {
	if (!dir.isDirectory()) continue;
	const collection = dir.name;
	const files = (await readdir(new URL(`content/${collection}/`, seedDir))).filter((f) => f.endsWith(".json")).sort();
	for (const file of files) {
		const entry = (await Bun.file(new URL(`content/${collection}/${file}`, seedDir)).json()) as Record<string, unknown>;
		entry.slug ??= file.replace(/\.json$/, "");
		entry.id ??= `${collection}-${entry.slug}`;
		(content[collection] ??= []).push(entry);
		fromFiles++;
	}
}
seed.content = content;

/* ---- resolve {"$env": "NAME"} and strip $schema ---- */

function resolve(node: unknown, path: string): unknown {
	if (Array.isArray(node)) return node.map((item, i) => resolve(item, `${path}[${i}]`));
	if (node && typeof node === "object") {
		const obj = node as Record<string, unknown>;
		if (typeof obj.$env === "string" && Object.keys(obj).length === 1) {
			const value = process.env[obj.$env];
			if (value === undefined) throw new Error(`seed ${path} references $env "${obj.$env}", which is not set`);
			return value;
		}
		return Object.fromEntries(
			Object.entries(obj)
				.filter(([k]) => k !== "$schema")
				.map(([k, v]) => [k, resolve(v, `${path}.${k}`)]),
		);
	}
	return node;
}

const doc = resolve(seed, "$") as Record<string, unknown>;
const total = Object.values(content).reduce((n, entries) => n + entries.length, 0);
console.log(`apply-seed: composed ${total} entries (${fromFiles} from files) across ${Object.keys(content).length} collections, ${sections.length} sections.`);

const res = await fetch(`${CMS_URL}/seed-api`, {
	method: "POST",
	headers: { "Content-Type": "application/json", "x-provision-secret": token },
	body: JSON.stringify(doc),
});
const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; error?: string };
if (!res.ok || !body.ok) {
	console.error(`apply-seed: failed (${res.status}): ${body.error ?? "unknown error"}`);
	process.exit(1);
}
console.log("apply-seed: applied.", JSON.stringify(body.result));
