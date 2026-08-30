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
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response("Method Not Allowed", { status: 405 });
	if (!PREVIEW_LABEL.test(label)) return plain(404, `No preview called "${label}".`);
	if (isBackendPath(url.pathname))
		return plain(404, "Previews are static: the backend is not available on a preview hostname.");
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
	return new Response(request.method === "HEAD" ? null : served.body, {
		status: served.status,
		headers: {
			"content-type": MIME[ext] ?? "application/octet-stream",
			"cache-control": "public, max-age=60",
			"x-robots-tag": "noindex, nofollow",
			"x-preview-branch": branch,
			"x-preview-commit": sha,
			vary: PREVIEW_HEADER,
		},
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
