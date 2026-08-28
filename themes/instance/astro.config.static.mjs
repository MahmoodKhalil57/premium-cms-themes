// Static-frontend build: renders the public site to static HTML from a local
// SQLite snapshot (bin/snapshot-to-sqlite.mjs), for hosting on GitHub Pages.
// No Cloudflare adapter, no Worker — EmDash's getDb() points at the snapshot
// file via a raw @premium-cms/emdash/db/sqlite descriptor, so the existing
// frontend data layer renders unchanged.
import react from "@astrojs/react";
import icon from "astro-iconset";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "@premium-cms/emdash/astro";

const snapshotFile = process.env.EMDASH_SNAPSHOT_DB || "snapshot.db";

const sqliteDatabase = {
	entrypoint: "@premium-cms/emdash/db/sqlite",
	config: { url: `file:${snapshotFile}` },
	type: "sqlite",
	migrations: {
		entrypoint: "@premium-cms/emdash/db/sqlite-migrations",
		manifestConfig: { url: `file:${snapshotFile}` },
	},
	supportsRequestScope: false,
	supportsCoalescing: false,
	supportsCollectionDeletionGuard: false,
};

// On GitHub Pages project sites the URL is <user>.github.io/<repo>, so split
// SITE_URL into the origin (site) and the subpath (base) — otherwise assets are
// linked at /_astro/… and 404. A custom domain sets SITE_URL to the root, so
// base becomes "/" automatically.
const _rawSite = process.env.SITE_URL || "https://example.com";
let _site = _rawSite,
	_base = "/";
try {
	const u = new URL(_rawSite);
	_site = u.origin;
	_base = u.pathname.replace(/\/+$/, "") || "/";
} catch {}

export default defineConfig({
	output: "static",
	site: _site,
	base: _base,
	image: { layout: "constrained", responsiveStyles: true },
	integrations: [
		react(),
		icon({
			include: {
				ph: [
					"chart-bar",
					"check-circle",
					"clock",
					"cloud",
					"code",
					"currency-dollar",
					"envelope",
					"globe",
					"heart",
					"lifebuoy",
					"lightning",
					"lock",
					"shield-check",
					"sparkle",
					"star",
					"users-three",
				],
			},
		}),
		emdash({
			database: sqliteDatabase,
			staticFrontend: true,
			plugins: [
				{
					id: "marketing-blocks",
					version: "0.1.0",
					entrypoint: new URL("./src/plugins/marketing-blocks/index.ts", import.meta.url).href,
				},
			],
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700, 800],
			fallbacks: ["sans-serif"],
		},
	],
	devToolbar: { enabled: false },
});
