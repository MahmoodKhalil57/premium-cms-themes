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
import { rmSync } from "node:fs";

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
db.close();
console.log(`✓ ${outFile}: ${created} tables, ${rowsTotal} rows from ${backend}`);
