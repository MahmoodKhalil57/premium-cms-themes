import {
	BrowserBridge,
	handleAgentRequest,
	PluginAgent,
	Sandbox,
} from "@premium-cms/cloudflare/agents";
import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";
import {
	cookieHas,
	EDIT_MODE_COOKIE,
	EDIT_PARAM,
	injectToolbarHtml,
	renderToolbar,
	TOOLBAR_MIN_ROLE,
} from "@premium-cms/emdash/visual-editing";

export { PluginBridge };
// The agent runtime: plugins reach it through ctx.agents / ctx.sandbox; the
// instance's own account hosts the AI, the objects and the build container.
export { BrowserBridge, PluginAgent, Sandbox };

/**
 * Backend Worker entry with a static-frontend proxy.
 *
 * `/_emdash/*` (admin + REST API + media) and `/.well-known/*` are always served
 * locally by EmDash. For every other GET/HEAD:
 *   - `FRONTEND_ORIGIN` set  → proxy to the static GitHub Pages build (the site's
 *     canonical frontend; links resolve with `base: /` at the domain root).
 *   - `FRONTEND_ORIGIN` unset → the frontend is not connected yet, so serve a
 *     "not set up" placeholder instead of EmDash's own SSR pages. The owner
 *     connects GitHub from Settings → General to enable it.
 *
 * The static build never sees a session, so the visual-editing toolbar that
 * EmDash's middleware would inject on a server-rendered page is spliced in
 * here instead: a request carrying the session cookie is checked against the
 * backend's own `auth/me` (in-process), and editors get the toolbar with
 * `private, no-store` caching. Anonymous visitors cost nothing extra.
 */
const BACKEND_PREFIXES = ["/_emdash", "/.well-known"];
const SESSION_COOKIE = "astro-session";
type Backend = { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> };
const backend = handler as Backend;

/** The requester's role per the backend (0 when anonymous or the check fails). */
async function roleOf(
	request: Request,
	url: URL,
	env: unknown,
	ctx: ExecutionContext,
): Promise<number> {
	try {
		const me = await backend.fetch(
			new Request(`${url.origin}/_emdash/api/auth/me`, {
				headers: {
					cookie: request.headers.get("cookie") ?? "",
					authorization: request.headers.get("authorization") ?? "",
					"X-EmDash-Request": "1",
					accept: "application/json",
				},
			}),
			env,
			ctx,
		);
		if (!me.ok) return 0;
		const body = (await me.json()) as { data?: { role?: unknown } } | null;
		const role = Number(body?.data?.role);
		return Number.isFinite(role) ? role : 0;
	} catch {
		return 0;
	}
}

function canonical(url: URL): Response {
	const target = new URL(url);
	target.searchParams.delete(EDIT_PARAM);
	return new Response(null, {
		status: 302,
		headers: {
			location: target.pathname + target.search + target.hash,
			"cache-control": "no-store",
		},
	});
}

function isBackendPath(pathname: string): boolean {
	return BACKEND_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function frontendDisabledPage(): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Site not set up yet</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
background:#0b1220;color:#e6edf6}
.card{max-width:34rem;text-align:center}
h1{font-size:1.7rem;margin:0 0 .5rem;letter-spacing:-.02em}
p{margin:.4rem 0;color:#9fb0c6}
.badge{display:inline-block;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;
color:#9fb0c6;border:1px solid #24344d;border-radius:999px;padding:.3rem .8rem;margin-bottom:1.2rem}
a{display:inline-block;margin-top:1.4rem;background:#3b82f6;color:#fff;text-decoration:none;
padding:.7rem 1.3rem;border-radius:.6rem;font-weight:600}
a:hover{background:#2f6fe0}
</style></head><body><div class="card">
<div class="badge">Frontend not connected</div>
<h1>This site isn't set up yet</h1>
<p>Connect a GitHub account to publish this site's frontend to GitHub Pages.</p>
<p>The owner can do this from <strong>Settings → General</strong> in the admin.</p>
<a href="/_emdash/admin/settings/general">Open admin settings</a>
</div></body></html>`;
	return new Response(html, {
		status: 503,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

const baseScheduled = createScheduledHandler();

// ── Previews served straight from git ────────────────────────────────────
//
// `https://<rn>--<label>.premium-cms.com` (the router forwards it here with
// `X-Premium-Preview: <label>`) serves the repository branch the platform's
// CI pushed for that label — `static/pr-12`, `static/main-b-1` — with the
// site's own GitHub connection. No Worker, no bucket: delete the branch and
// the preview is gone. Files are cached at the edge by commit, so GitHub sees
// one request per file per build, and every response says which commit it is.

/** A static branch name without its `static/` prefix: `pr-12`, `main`, `main-b-1`. */
const PREVIEW_LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PREVIEW_HEADER = "x-premium-preview";

// ── Editors on previews ─────────────────────────────────────────────────
//
// A preview hostname is its own origin, so the editor's session cookie (host
// only) is not there. The first HTML navigation without a session bounces once
// to the site's canonical origin, `/_emdash/preview-session/start?to=…`, which
// — for a signed-in editor — mints a single-use, 60-second ticket in the SESSION
// namespace and sends them back to `/_emdash/preview-session?ticket=…` on the
// preview host, where the ticket becomes the same session cookie for that host.
// Anyone else comes back with a marker cookie instead, so they bounce only once.
// With a session on the preview host, `/_emdash/*` is served by the backend
// like anywhere else and preview pages get the toolbar (and its plugins).
const PREVIEW_SESSION_PATH = "/_emdash/preview-session";
const PREVIEW_SESSION_START = `${PREVIEW_SESSION_PATH}/start`;
const PREVIEW_ANON_COOKIE = "emdash_preview_anon";
const PREVIEW_TICKET_TTL = 60;

type SiteOrigins = { siteUrl: string; platformUrl: string };
let originsCache: { at: number; value: SiteOrigins } | null = null;

/** The site's canonical URL (where editors sign in) and its platform URL, from the options table. */
async function siteOrigins(env: Record<string, unknown>): Promise<SiteOrigins> {
	if (originsCache && Date.now() - originsCache.at < 60_000) return originsCache.value;
	const db = env.DB as D1Database | undefined;
	const map = new Map<string, string>();
	if (db) {
		const rows = await db
			.prepare(
				"SELECT name, value FROM options WHERE name IN ('emdash:site_url','custom_domain:default_url')",
			)
			.all<{ name: string; value: string }>();
		for (const r of rows.results ?? []) {
			try {
				const v = JSON.parse(r.value) as unknown;
				if (typeof v === "string") map.set(r.name, v);
			} catch {
				map.set(r.name, r.value);
			}
		}
	}
	const platformUrl = (map.get("custom_domain:default_url") ?? "").replace(/\/+$/, "");
	const siteUrl = (map.get("emdash:site_url") ?? platformUrl).replace(/\/+$/, "");
	const value = { siteUrl, platformUrl };
	originsCache = { at: Date.now(), value };
	return value;
}

/** `https://<rn>--<label>.<platform zone>` for this site, or null when the site has no platform URL. */
function previewOrigin(platformUrl: string, label: string): string | null {
	let host: string;
	try {
		host = new URL(platformUrl).hostname;
	} catch {
		return null;
	}
	const dot = host.indexOf(".");
	if (dot <= 0) return null;
	return `https://${host.slice(0, dot)}--${label}.${host.slice(dot + 1)}`;
}

/** The preview label of a URL on one of this site's preview hostnames, or null. */
function previewLabelOf(platformUrl: string, target: URL): string | null {
	if (target.protocol !== "https:") return null;
	let host: string;
	try {
		host = new URL(platformUrl).hostname;
	} catch {
		return null;
	}
	const dot = host.indexOf(".");
	if (dot <= 0) return null;
	const m = target.hostname.match(/^([a-z0-9]+)--([a-z0-9][a-z0-9-]{0,40})\.(.+)$/);
	if (!m || m[1] !== host.slice(0, dot) || m[3] !== host.slice(dot + 1)) return null;
	return m[2] ?? null;
}

function cookieValue(cookie: string | null, name: string): string | null {
	if (!cookie) return null;
	for (const part of cookie.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

function redirect(location: string, setCookie?: string[]): Response {
	const headers = new Headers({
		location,
		"cache-control": "no-store",
		"x-robots-tag": "noindex, nofollow",
	});
	for (const c of setCookie ?? []) headers.append("set-cookie", c);
	return new Response(null, { status: 302, headers });
}

/** A same-origin path to return to after the handoff (never another host). */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
	return raw;
}

function randomTicket(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `/_emdash/preview-session/start?to=<preview url>` on the site's own origin: hand a signed-in editor over to the preview host. */
async function startPreviewSession(
	request: Request,
	url: URL,
	env: Record<string, unknown>,
	ctx: ExecutionContext,
): Promise<Response> {
	const { siteUrl, platformUrl } = await siteOrigins(env);
	let to: URL;
	try {
		to = new URL(url.searchParams.get("to") ?? "");
	} catch {
		return new Response("Bad request", { status: 400 });
	}
	const devTarget =
		to.protocol === "http:" && (to.hostname === "localhost" || to.hostname === "127.0.0.1");
	if (!devTarget && (!platformUrl || !previewLabelOf(platformUrl, to)))
		return new Response("Not one of this site's previews.", { status: 400 });
	const next = encodeURIComponent(to.pathname + to.search);
	const cookie = request.headers.get("cookie");
	const session = cookieValue(cookie, SESSION_COOKIE);
	const kv = env.SESSION as KVNamespace | undefined;
	if (session && kv && (await roleOf(request, url, env, ctx)) >= TOOLBAR_MIN_ROLE) {
		const ticket = randomTicket();
		await kv.put(
			`preview-ticket:${ticket}`,
			JSON.stringify({ session, exp: Date.now() + PREVIEW_TICKET_TTL * 1000, origin: to.origin }),
			{ expirationTtl: PREVIEW_TICKET_TTL },
		);
		return redirect(`${to.origin}${PREVIEW_SESSION_PATH}?ticket=${ticket}&next=${next}`);
	}
	if (devTarget) {
		// Local dev has no session yet: authenticate on THIS origin (passkeys
		// and magic-link emails only work here), then return to this handoff.
		const back = encodeURIComponent(url.pathname + url.search);
		return redirect(`${siteUrl || url.origin}/_emdash/admin/login?redirect=${back}`);
	}
	return redirect(`${to.origin}${PREVIEW_SESSION_PATH}?anon=1&next=${next}`);
}

/** `/_emdash/preview-session?ticket=…|anon=1&next=…` on a preview host: turn the ticket into this host's session cookie. */
async function finishPreviewSession(url: URL, env: Record<string, unknown>): Promise<Response> {
	const next = safeNext(url.searchParams.get("next"));
	const ticket = url.searchParams.get("ticket") ?? "";
	const kv = env.SESSION as KVNamespace | undefined;
	const anon = `${PREVIEW_ANON_COOKIE}=1; Path=/; Max-Age=1800; Secure; SameSite=Lax`;
	if (/^[0-9a-f]{64}$/.test(ticket) && kv) {
		const key = `preview-ticket:${ticket}`;
		const raw = await kv.get(key);
		if (raw) {
			await kv.delete(key);
			try {
				const t = JSON.parse(raw) as { session?: string; exp?: number; origin?: string };
				if (typeof t.session === "string" && t.session && (t.exp ?? 0) > Date.now()) {
					// A local-dev target reaches this through the site's vite proxy;
					// Safari refuses Secure cookies on plain http://localhost.
					const secure = t.origin?.startsWith("http://") ? "" : " Secure;";
					return redirect(next, [
						`${SESSION_COOKIE}=${t.session}; Path=/; HttpOnly;${secure} SameSite=Lax`,
						`${PREVIEW_ANON_COOKIE}=; Path=/; Max-Age=0;${secure} SameSite=Lax`,
					]);
				}
			} catch {
				// fall through: an unreadable ticket is treated like none
			}
		}
	}
	return redirect(next, [anon]);
}

/** A top-level HTML navigation (the only requests worth bouncing for a session). */
function isDocumentNavigation(request: Request): boolean {
	if (request.method !== "GET") return false;
	const dest = request.headers.get("sec-fetch-dest");
	if (dest && dest !== "document") return false;
	return (request.headers.get("accept") ?? "").includes("text/html");
}
/** How long a branch head is trusted before GitHub is asked again. */
const REF_TTL_SECONDS = 10;
const GITHUB = "https://api.github.com";
const MIME: Record<string, string> = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	map: "application/json; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	webmanifest: "application/manifest+json",
	wasm: "application/wasm",
	pdf: "application/pdf",
	mp4: "video/mp4",
	webm: "video/webm",
	mp3: "audio/mpeg",
};

interface RepoConnection {
	token: string;
	owner: string;
	repo: string;
}

let connectionCache: { at: number; value: RepoConnection | null } | null = null;

/** The site's GitHub connection (Settings → General), read straight from the options table and kept for a minute. */
async function repoConnection(env: Record<string, unknown>): Promise<RepoConnection | null> {
	if (connectionCache && Date.now() - connectionCache.at < 60_000) return connectionCache.value;
	const db = env.DB as D1Database | undefined;
	let value: RepoConnection | null = null;
	if (db) {
		const rows = await db
			.prepare(
				"SELECT name, value FROM options WHERE name IN ('github:token','github:owner','github:repo')",
			)
			.all<{ name: string; value: string }>();
		const map = new Map<string, string>();
		for (const r of rows.results ?? []) {
			try {
				const v = JSON.parse(r.value) as unknown;
				if (typeof v === "string") map.set(r.name, v);
			} catch {
				map.set(r.name, r.value);
			}
		}
		const token = map.get("github:token") ?? "";
		const owner = map.get("github:owner") ?? "";
		const repo = map.get("github:repo") ?? "";
		value = token && owner && repo ? { token, owner, repo } : null;
	}
	connectionCache = { at: Date.now(), value };
	return value;
}

function githubHeaders(token: string, accept: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: accept,
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "premium-cms-instance/1.0",
	};
}

/** The branch's current commit, cached briefly so a build's force-push shows within seconds. */
async function branchHead(
	conn: RepoConnection,
	branch: string,
	ctx: ExecutionContext,
): Promise<string | null> {
	const cache = (caches as unknown as { default: Cache }).default;
	const key = new Request(`https://preview.internal/${conn.owner}/${conn.repo}/ref/${branch}`);
	const hit = await cache.match(key);
	if (hit) return (await hit.text()) || null;
	const r = await fetch(`${GITHUB}/repos/${conn.owner}/${conn.repo}/git/ref/heads/${branch}`, {
		headers: githubHeaders(conn.token, "application/vnd.github+json"),
	});
	if (!r.ok) return null;
	const sha = String(((await r.json()) as { object?: { sha?: string } }).object?.sha ?? "");
	if (!/^[0-9a-f]{40}$/.test(sha)) return null;
	ctx.waitUntil(
		cache.put(
			key,
			new Response(sha, { headers: { "cache-control": `max-age=${REF_TTL_SECONDS}` } }),
		),
	);
	return sha;
}

/** One file of the branch at that commit — immutable, so cached for good. */
async function branchFile(
	conn: RepoConnection,
	sha: string,
	path: string,
	ctx: ExecutionContext,
): Promise<{ status: number; body: ArrayBuffer } | null> {
	const cache = (caches as unknown as { default: Cache }).default;
	const key = new Request(`https://preview.internal/${conn.owner}/${conn.repo}/${sha}/${path}`);
	const hit = await cache.match(key);
	if (hit) return hit.status === 204 ? null : { status: 200, body: await hit.arrayBuffer() };
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	const r = await fetch(
		`${GITHUB}/repos/${conn.owner}/${conn.repo}/contents/${encoded}?ref=${sha}`,
		{
			headers: githubHeaders(conn.token, "application/vnd.github.raw+json"),
		},
	);
	if (r.status === 404 || r.status === 403) {
		// Remember the miss too (a directory, or nothing there), briefly.
		ctx.waitUntil(
			cache.put(
				key,
				new Response(null, { status: 204, headers: { "cache-control": "max-age=300" } }),
			),
		);
		return null;
	}
	if (!r.ok) return null;
	const body = await r.arrayBuffer();
	ctx.waitUntil(
		cache.put(
			key,
			new Response(body.slice(0), {
				headers: { "cache-control": "public, max-age=31536000, immutable" },
			}),
		),
	);
	return { status: 200, body };
}

/** Candidate files for a request path, the way a static host resolves them (Astro's directory format). */
function previewCandidates(pathname: string): string[] {
	let p = decodeURIComponent(pathname).replace(/^\/+/, "");
	if (p.includes("..")) return [];
	if (p === "" || p.endsWith("/")) return [`${p}index.html`];
	const last = p.split("/").pop() ?? "";
	if (!last.includes(".")) return [`${p}/index.html`, `${p}.html`];
	return [p];
}

async function servePreview(
	request: Request,
	url: URL,
	env: Record<string, unknown>,
	ctx: ExecutionContext,
	label: string,
): Promise<Response> {
	const plain = (status: number, text: string) =>
		new Response(text, {
			status,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
				"x-robots-tag": "noindex, nofollow",
			},
		});
	if (!PREVIEW_LABEL.test(label)) return plain(404, `No preview called "${label}".`);
	// The session handoff, then everything under /_emdash (admin, API, media) as on any other hostname.
	if (url.pathname === PREVIEW_SESSION_PATH) return finishPreviewSession(url, env);
	if (isBackendPath(url.pathname)) return backend.fetch(request, env, ctx);
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response("Method Not Allowed", { status: 405 });
	const conn = await repoConnection(env);
	if (!conn)
		return plain(503, "This site has no GitHub connection, so there is nothing to preview.");
	const branch = `static/${label}`;
	const sha = await branchHead(conn, branch, ctx);
	if (!sha)
		return plain(
			404,
			`No preview "${label}" — the repository has no ${branch} branch (yet, or any more).`,
		);
	let served: { path: string; body: ArrayBuffer; status: number } | null = null;
	for (const candidate of previewCandidates(url.pathname)) {
		const file = await branchFile(conn, sha, candidate, ctx);
		if (file) {
			served = { path: candidate, body: file.body, status: 200 };
			break;
		}
	}
	if (!served) {
		const notFound = await branchFile(conn, sha, "404.html", ctx);
		served = notFound ? { path: "404.html", body: notFound.body, status: 404 } : null;
	}
	if (!served) return plain(404, "Not found in this preview.");
	const ext = served.path.split(".").pop()?.toLowerCase() ?? "";
	const headers: Record<string, string> = {
		"content-type": MIME[ext] ?? "application/octet-stream",
		"cache-control": "public, max-age=60",
		"x-robots-tag": "noindex, nofollow",
		"x-preview-branch": branch,
		"x-preview-commit": sha,
		vary: PREVIEW_HEADER,
	};
	if (ext === "html" && request.method === "GET") {
		const cookie = request.headers.get("cookie");
		const hasSession = !!cookieValue(cookie, SESSION_COOKIE);
		if (hasSession && (await roleOf(request, url, env, ctx)) >= TOOLBAR_MIN_ROLE) {
			const toolbar = renderToolbar({
				editMode: cookieHas(cookie, EDIT_MODE_COOKIE, "true"),
				isPreview: true,
			});
			const html = injectToolbarHtml(new TextDecoder().decode(served.body), toolbar);
			return new Response(html, {
				status: served.status,
				headers: { ...headers, "cache-control": "private, no-store" },
			});
		}
		// No session here yet: one bounce through the site's origin decides whether there is an editor to hand over.
		if (!hasSession && !cookieValue(cookie, PREVIEW_ANON_COOKIE) && isDocumentNavigation(request)) {
			const { siteUrl, platformUrl } = await siteOrigins(env);
			const origin = platformUrl ? previewOrigin(platformUrl, label) : null;
			if (siteUrl && origin) {
				const to = encodeURIComponent(`${origin}${url.pathname}${url.search}`);
				return redirect(`${siteUrl}${PREVIEW_SESSION_START}?to=${to}`);
			}
		}
	}
	return new Response(request.method === "HEAD" ? null : served.body, {
		status: served.status,
		headers,
	});
}

export default {
	...handler,
	async fetch(
		request: Request,
		env: Record<string, unknown>,
		ctx: ExecutionContext,
	): Promise<Response> {
		const origin =
			typeof env.FRONTEND_ORIGIN === "string" ? env.FRONTEND_ORIGIN.replace(/\/+$/, "") : "";
		const url = new URL(request.url);
		// The agent runtime's public endpoints (toolbar client, ticket-gated chat socket, browser bridge).
		if (url.pathname.startsWith("/_emdash/agents/")) {
			const served = await handleAgentRequest(request, env as never);
			if (served) return served;
		}
		// A preview hostname (via the router): serve the requested static branch from git.
		const previewLabel = request.headers.get(PREVIEW_HEADER);
		if (previewLabel) return servePreview(request, url, env, ctx, previewLabel.toLowerCase());
		// An editor on the way to a preview hostname (see "Editors on previews").
		if (url.pathname === PREVIEW_SESSION_START) return startPreviewSession(request, url, env, ctx);
		// The finish leg for a local-dev target arrives here through the site's
		// vite proxy (no preview header); Set-Cookie passes through to localhost.
		if (url.pathname === PREVIEW_SESSION_PATH) return finishPreviewSession(url, env);
		// Public (non-backend) paths are NEVER served by EmDash's own SSR: the
		// frontend is the GitHub Pages build, reached only through this proxy.
		if (!isBackendPath(url.pathname)) {
			if (!origin) return frontendDisabledPage();
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			const cookie = request.headers.get("cookie");
			const wantsEdit = url.searchParams.has(EDIT_PARAM);
			const mayBeEditor =
				cookie?.includes(`${SESSION_COOKIE}=`) || request.headers.has("authorization") || wantsEdit;
			const role = mayBeEditor ? await roleOf(request, url, env, ctx) : 0;
			const editor = role >= TOOLBAR_MIN_ROLE;
			// A shared `?_edit` link degrades to the plain page for everyone else.
			if (wantsEdit && !editor) return canonical(url);

			const headers = new Headers(request.headers);
			headers.delete("host");
			const search = new URLSearchParams(url.search);
			search.delete(EDIT_PARAM);
			const query = search.toString();
			const upstream = await fetch(`${origin}${url.pathname}${query ? `?${query}` : ""}`, {
				method: request.method,
				headers,
				redirect: "follow",
			});
			// Copy through; strip hop-by-hop / origin-specific headers.
			const out = new Headers(upstream.headers);
			out.delete("content-encoding");
			out.delete("content-length");
			if (
				editor &&
				request.method === "GET" &&
				(out.get("content-type") ?? "").includes("text/html")
			) {
				const toolbar = renderToolbar({
					editMode: cookieHas(cookie, EDIT_MODE_COOKIE, "true"),
					isPreview: false,
				});
				out.set("cache-control", "private, no-store");
				return new Response(injectToolbarHtml(await upstream.text(), toolbar), {
					status: upstream.status,
					headers: out,
				});
			}
			return new Response(upstream.body, { status: upstream.status, headers: out });
		}
		return (
			handler as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }
		).fetch(request, env, ctx);
	},
	scheduled: async (
		event: ScheduledController,
		env: Record<string, unknown>,
		ctx: ExecutionContext,
	) => {
		ctx.waitUntil(Promise.resolve(baseScheduled(event as never, env as never, ctx)));
		const self = (env as { SELF?: { fetch: typeof fetch } }).SELF;
		if (!self) return;
		try {
			// Drive the (public) provisioning tick through the SELF service binding
			// so any configured instance can act as a control plane. No-ops unless
			// the projects plugin is configured with Cloudflare credentials.
			await self.fetch("https://self.internal/_emdash/api/plugins/premiumcms-projects/tick", {
				method: "POST",
				headers: { "X-EmDash-Request": "1" },
			});
		} catch {
			// Retried next minute; never block maintenance.
		}
	},
};
