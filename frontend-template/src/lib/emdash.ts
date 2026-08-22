/**
 * Headless data layer for the PremiumCMS frontend template.
 *
 * The pages in this template are the official EmDash starter theme, with the
 * `emdash` package's server calls replaced by this module: the same call
 * surface, backed by the CMS instance's public feed (`/frontend-api/*`) at
 * BUILD time. `astro build` pre-renders every page with real content; the
 * result is plain static HTML served by GitHub Pages — no server logic.
 *
 * Every fetch is fail-soft: if the CMS is unreachable the build still
 * succeeds with empty content rather than failing the deploy.
 */
import { CMS_URL, SITE_TITLE, TAGLINE } from "../config";

/* ------------------------------------------------------------------ */
/* Types mirrored from the emdash package (subset the template uses)   */
/* ------------------------------------------------------------------ */

export interface PortableTextBlock {
	_type: string;
	children?: unknown[];
	[key: string]: unknown;
}

export interface MediaValue {
	id?: string;
	src?: string;
	meta?: { storageKey?: string };
	alt?: string;
	width?: number;
	height?: number;
	mimeType?: string;
	filename?: string;
}

export interface Term {
	slug: string;
	label: string;
}

export interface Entry {
	/** The slug — used in URLs, matching emdash's entry.id convention. */
	id: string;
	data: {
		/** The database ULID. */
		id: string;
		slug: string;
		title?: string;
		excerpt?: string;
		content?: PortableTextBlock[];
		featured_image?: MediaValue | null;
		publishedAt?: Date | null;
		/** Taxonomy name → terms, e.g. { tag: [...], category: [...] }. */
		terms: Record<string, Term[]>;
		/** Every column of the entry (custom collections such as `products`); JSON columns parsed. */
		fields: Record<string, unknown>;
	};
}

interface Row {
	id: string;
	slug: string;
	title?: string;
	excerpt?: string;
	content?: string;
	featured_image?: string;
	published_at?: string;
	created_at?: string;
	terms?: Record<string, Term[]>;
	[column: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Data access (build-time, against the CMS's public feed)             */
/* ------------------------------------------------------------------ */

async function feed<T>(path: string): Promise<T | null> {
	if (!CMS_URL) return null;
	try {
		const res = await fetch(`${CMS_URL}${path}`, { signal: AbortSignal.timeout(15000) });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

function parseJson<T>(value: string | null | undefined): T | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

function toEntry(row: Row): Entry {
	const publishedRaw = row.published_at ?? row.created_at;
	const published = publishedRaw ? new Date(publishedRaw) : null;
	return {
		id: row.slug,
		data: {
			id: row.id,
			slug: row.slug,
			title: row.title,
			excerpt: row.excerpt,
			content: parseJson<PortableTextBlock[]>(row.content),
			featured_image: parseJson<MediaValue>(row.featured_image) ?? null,
			publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
			terms: row.terms ?? {},
			fields: Object.fromEntries(
				Object.entries(row).map(([key, value]) => {
					if (typeof value !== "string") return [key, value];
					const trimmed = value.trim();
					if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
						return [key, parseJson<unknown>(value) ?? value];
					}
					return [key, value];
				}),
			),
		},
	};
}

const collectionCache = new Map<string, Promise<Entry[]>>();

export async function getEmDashCollection(
	collection: string,
	options?: { orderBy?: Record<string, string>; limit?: number },
): Promise<{ entries: Entry[]; cacheHint: Record<string, never> }> {
	// One fetch per collection per build; pages slice what they need.
	let promise = collectionCache.get(collection);
	if (!promise) {
		promise = feed<{ items?: Row[] }>(`/frontend-api/${collection}.json?limit=50`).then((data) =>
			(data?.items ?? []).map(toEntry),
		);
		collectionCache.set(collection, promise);
	}
	const entries = await promise;
	return { entries: options?.limit ? entries.slice(0, options.limit) : entries, cacheHint: {} };
}

export async function getSiteSettings(): Promise<{ title?: string; tagline?: string }> {
	const data = await feed<{ title?: string; tagline?: string }>("/frontend-api/site.json");
	// Fall back to the identity baked into src/config.ts when the CMS is unreachable.
	return {
		title: data?.title ?? (SITE_TITLE || undefined),
		tagline: data?.tagline ?? (TAGLINE || undefined),
	};
}

/** Menus come from the CMS Menus manager, with a static default when the
 *  CMS has none (or is unreachable at build time). */
let menusPromise: Promise<Record<string, { items: Array<{ url: string; label: string; target?: string }> }>> | null =
	null;

function fetchMenus(): Promise<Record<string, { items: Array<{ url: string; label: string; target?: string }> }>> {
	menusPromise ??= (async () => {
		const data = await feed<{
			menus?: Record<string, { items: Array<{ url: string; label: string; target?: string }> }>;
		}>("/frontend-api/layout.json");
		return data?.menus ?? {};
	})();
	return menusPromise;
}

export async function getMenu(
	name: string,
): Promise<{ items: Array<{ url: string; label: string; target?: string }> } | null> {
	const menus = await fetchMenus();
	if (menus[name]?.items?.length) return menus[name];
	if (name === "primary") {
		return {
			items: [
				{ url: "/", label: "Home" },
				{ url: "/posts", label: "Posts" },
			],
		};
	}
	return null;
}

/** Terms per entry, from the feed's attached taxonomy data. */
export async function getTermsForEntries(
	collection: string,
	entryIds: string[],
	taxonomy: string,
): Promise<Map<string, Term[]>> {
	const { entries } = await getEmDashCollection(collection);
	const map = new Map<string, Term[]>();
	for (const entry of entries) {
		if (entryIds.includes(entry.data.id)) map.set(entry.data.id, entry.data.terms[taxonomy] ?? []);
	}
	return map;
}

/** All terms of a taxonomy used by a collection's published entries. */
export async function getUsedTerms(collection: string, taxonomy: string): Promise<Term[]> {
	const { entries } = await getEmDashCollection(collection);
	const seen = new Map<string, Term>();
	for (const entry of entries) {
		for (const term of entry.data.terms[taxonomy] ?? []) seen.set(term.slug, term);
	}
	return [...seen.values()];
}

/** Raw layout feed (menus, widget areas, sections) — the platform swaps this for a direct read when it hosts the site. */
export async function fetchLayoutData(): Promise<Record<string, never> | { menus?: Record<string, unknown>; widgetAreas?: Record<string, unknown>; sections?: Record<string, unknown>; siteKit?: unknown } | null> {
	return feed("/frontend-api/layout.json");
}
