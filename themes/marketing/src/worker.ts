import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };

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
 */
const BACKEND_PREFIXES = ["/_emdash", "/.well-known"];

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
		// Public (non-backend) paths are NEVER served by EmDash's own SSR: the
		// frontend is the GitHub Pages build, reached only through this proxy.
		if (!isBackendPath(url.pathname)) {
			if (!origin) return frontendDisabledPage();
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			const headers = new Headers(request.headers);
			headers.delete("host");
			const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
				method: request.method,
				headers,
				redirect: "follow",
			});
			// Copy through; strip hop-by-hop / origin-specific headers.
			const out = new Headers(upstream.headers);
			out.delete("content-encoding");
			out.delete("content-length");
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
		ctx.waitUntil(baseScheduled(event as never, env as never, ctx));
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
