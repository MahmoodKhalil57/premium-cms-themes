import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };

/**
 * Backend Worker entry: static-frontend proxy + platform maintenance tick.
 *
 * When `FRONTEND_ORIGIN` is set (the site's static build on GitHub Pages), this
 * Worker is the single canonical origin for premium-cms.com: `/_emdash/*` (admin
 * + REST API + media) and `/.well-known/*` are served locally by EmDash, while
 * every other GET/HEAD is proxied to the static frontend. So `https://premium-cms.com/`
 * serves the fast static Astro build while `/_emdash/admin` and the API keep
 * working. Without `FRONTEND_ORIGIN` this is a no-op (EmDash's own SSR pages).
 */
const BACKEND_PREFIXES = ["/_emdash", "/.well-known"];

function isBackendPath(pathname: string): boolean {
	return BACKEND_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function frontendDisabledPage(): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Site not set up yet</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf6}.card{max-width:34rem;text-align:center}h1{font-size:1.7rem;margin:0 0 .5rem;letter-spacing:-.02em}p{margin:.4rem 0;color:#9fb0c6}a{display:inline-block;margin-top:1.4rem;background:#3b82f6;color:#fff;text-decoration:none;padding:.7rem 1.3rem;border-radius:.6rem;font-weight:600}</style></head><body><div class="card">
<h1>This site isn't set up yet</h1><p>Connect a GitHub account to publish this site's frontend to GitHub Pages.</p>
<p>The owner can do this from <strong>Settings → General</strong> in the admin.</p>
<a href="/_emdash/admin/settings/general">Open admin settings</a></div></body></html>`;
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
			const out = new Headers(upstream.headers);
			out.delete("content-encoding");
			out.delete("content-length");
			return new Response(upstream.body, { status: upstream.status, headers: out });
		}
		return (
			handler as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }
		).fetch(request, env, ctx);
	},
	scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(baseScheduled(event, env, ctx));
		const self = (env as unknown as { SELF?: { fetch: typeof fetch } }).SELF;
		if (!self) return;
		try {
			// Self service-binding (not a public fetch — a Worker's subrequest to
			// its own custom domain does not reliably loop back) → the public
			// provisioning tick. No token: the tick route is public.
			await self.fetch("https://self.internal/_emdash/api/plugins/premiumcms-projects/tick", {
				method: "POST",
				headers: { "X-EmDash-Request": "1" },
			});
		} catch {
			// Retried next minute; never block maintenance.
		}
	},
};
