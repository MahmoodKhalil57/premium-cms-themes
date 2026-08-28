/**
 * Snapshot → local SQLite loader for the static-frontend build.
 *
 * Fetches a portable content snapshot from a live backend
 * (`${BACKEND}/_emdash/api/snapshot`, authed with an HMAC preview signature)
 * and materializes it as a local SQLite file. A subsequent `astro build`
 * (output: static) points EmDash's getDb() at this file via a raw
 * `@premium-cms/emdash/db/sqlite` DatabaseDescriptor, so the entire existing
 * frontend data layer renders the site statically — no per-helper rewrite.
 *
 * The snapshot carries all content + safe options + the schema (columns/types)
 * and the `_emdash_migrations` rows, so we CREATE the tables from that schema
 * and INSERT every row; the build's migration run then no-ops.
 *
 *   node bin/snapshot-to-sqlite.mjs <backend-url> <out.db>
 * env: EMDASH_PREVIEW_SECRET (matches the backend's emdash:preview_secret)
 */
import BetterSqlite3 from "better-sqlite3";
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const backend = (process.argv[2] || process.env.BACKEND_URL || "").replace(/\/$/, "");
const outFile = process.argv[3] || process.env.EMDASH_SNAPSHOT_DB || "snapshot.db";
const secret = process.env.EMDASH_PREVIEW_SECRET;
if (!backend || !secret) {
	console.error(
		"usage: snapshot-to-sqlite.mjs <backend-url> <out.db>  (env EMDASH_PREVIEW_SECRET)",
	);
	process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + 300;
const source = backend;
const sig = crypto.createHmac("sha256", secret).update(`${source}:${exp}`).digest("hex");

const res = await fetch(`${backend}/_emdash/api/snapshot`, {
	headers: { "X-Preview-Signature": `${source}:${exp}:${sig}` },
});
if (!res.ok) {
	console.error(`snapshot fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	process.exit(1);
}
const body = await res.json();
const snap = body.data ?? body;
const { tables, schema } = snap;
if (!tables || !schema) {
	console.error("snapshot missing tables/schema");
	process.exit(1);
}

rmSync(outFile, { force: true });
const db = new BetterSqlite3(outFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

let created = 0;
for (const [table, info] of Object.entries(schema)) {
	const cols = info.columns.map((c) => `"${c}" ${info.types?.[c] ?? ""}`.trim()).join(", ");
	db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${cols})`);
	created++;
}

// Tables the public render path queries but the snapshot deliberately omits
// (comments carry commenter PII and hydrate client-side; cron is runtime
// bookkeeping). Empty stand-ins keep the build from throwing on them.
const STUBS = {
	_emdash_comments:
		"id text primary key, collection text, content_id text, parent_id text, author_name text, author_email text, author_url text, author_user_id text, body text, status text, ip_hash text, user_agent text, moderation_metadata text, created_at text, updated_at text",
	_emdash_comment_reactions:
		"id text primary key, comment_id text, reaction text, voter_hash text, created_at text",
	_emdash_cron_tasks:
		"id text primary key, plugin_id text, task_name text, schedule text, is_oneshot integer, data text, next_run_at text, last_run_at text, status text, locked_at text, enabled integer, created_at text",
};
for (const [table, cols] of Object.entries(STUBS)) {
	if (!schema[table]) db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${cols})`);
}

let rowsTotal = 0;
const insertAll = db.transaction(() => {
	for (const [table, rows] of Object.entries(tables)) {
		if (!Array.isArray(rows) || rows.length === 0) continue;
		const cols = schema[table]?.columns;
		if (!cols) continue;
		const stmt = db.prepare(
			`INSERT OR IGNORE INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
		);
		for (const r of rows) {
			stmt.run(cols.map((c) => (r[c] === undefined ? null : r[c])));
			rowsTotal++;
		}
	}
});
insertAll();

/*
 * Git-backed collections (`_emdash_collections.storage = 'git'`) keep their
 * entries in THIS repo as content/<collection>/<slug>.json — the backend holds
 * only their schema. Materialize those files straight into the ec_* tables so
 * the static build renders them without any backend request.
 */
const JSON_TYPES = new Set([
	"portableText",
	"json",
	"multiSelect",
	"repeater",
	"media",
	"relation",
	"file",
]);
let gitRows = 0;
const gitCollections = (tables._emdash_collections ?? []).filter((c) => c.storage === "git");
if (gitCollections.length > 0) {
	const fieldsByCollection = new Map();
	for (const f of tables._emdash_fields ?? []) {
		if (!fieldsByCollection.has(f.collection_id)) fieldsByCollection.set(f.collection_id, []);
		fieldsByCollection.get(f.collection_id).push(f);
	}
	const insertGit = db.transaction(() => {
		for (const c of gitCollections) {
			const table = `ec_${c.slug}`;
			const cols = schema[table]?.columns;
			if (!cols) continue;
			const dir = path.join("content", c.slug);
			if (!existsSync(dir)) continue;
			const fields = fieldsByCollection.get(c.id) ?? [];
			const stmt = db.prepare(
				`INSERT OR REPLACE INTO "${table}" (${cols.map((x) => `"${x}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
			);
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".json")) continue;
				let entry;
				try {
					entry = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
				} catch (err) {
					console.error(`  ! ${dir}/${file}: ${err.message}`);
					continue;
				}
				if ((entry.status ?? "published") !== "published" && !process.env.EMDASH_INCLUDE_DRAFTS)
					continue;
				const slug = entry.slug ?? file.slice(0, -5);
				const row = {
					id: entry.id ?? slug,
					slug,
					status: entry.status ?? "published",
					locale: entry.locale ?? "en",
					translation_group: entry.translationGroup ?? slug,
					created_at: entry.createdAt ?? entry.updatedAt ?? new Date().toISOString(),
					updated_at: entry.updatedAt ?? new Date().toISOString(),
					published_at: entry.publishedAt ?? entry.updatedAt ?? null,
					version: 1,
				};
				for (const f of fields) {
					const v = entry.data?.[f.slug];
					if (v === undefined) continue;
					row[f.slug] =
						JSON_TYPES.has(f.type) || (v && typeof v === "object")
							? JSON.stringify(v)
							: typeof v === "boolean"
								? v
									? 1
									: 0
								: v;
				}
				stmt.run(cols.map((x) => (row[x] === undefined ? null : row[x])));
				gitRows++;
			}
		}
	});
	insertGit();
}

db.close();
console.log(
	`✓ ${outFile}: ${created} tables, ${rowsTotal} rows from ${backend}${gitRows ? ` + ${gitRows} git-backed entries from content/` : ""}`,
);
