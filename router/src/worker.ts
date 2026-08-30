/**
 * Custom-domain router — the Cloudflare-for-SaaS fallback origin.
 *
 * When an owner points a custom domain at the platform, a custom hostname is
 * created on the premium-cms.com zone with THIS worker as the fallback origin.
 * Traffic for every custom hostname arrives here with the original Host; we look
 * the hostname up in the DOMAINS KV (custom hostname → the instance's canonical
 * `p<ulid>.premium-cms.com` origin) and proxy through to that instance, which
 * serves the admin/API locally and proxies the public frontend to GitHub Pages.
 *
 * Runs on the zone-wide `*\/*` route (the only pattern Cloudflare matches for
 * custom-hostname traffic), so it also sees the platform's own hostnames;
 * those pass straight through to their Workers-custom-domain origin.
 */
interface Env {
	DOMAINS: KVNamespace;
}

/** `p<ulid>--<label>` — the instance's canonical name, two dashes, a preview label (pr-12, main-b-1). */
const PREVIEW_HOST = /^(p[0-9a-z]{26})--([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\.premium-cms\.com$/;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const host = url.hostname.toLowerCase();
		const target = await env.DOMAINS.get(host);
		// `<rn>--<label>.premium-cms.com`: a preview of that instance served
		// straight from its repository (static/pr-N, static/main-b-N). The
		// wildcard record brings every such hostname here; the instance decides
		// what the label means.
		const preview = !target ? host.match(PREVIEW_HOST) : null;
		if (preview) {
			const [, rn, label] = preview;
			return proxy(request, `https://${rn}.premium-cms.com${url.pathname}${url.search}`, {
				"X-Premium-Preview": label,
			});
		}
		if (!target && (host === "premium-cms.com" || host.endsWith(".premium-cms.com"))) {
			// One of ours (master, apex, an instance, the marketplace…): its
			// Workers custom domain is the origin for this subrequest.
			return fetch(request);
		}
		if (!target) {
			return new Response("This domain is not connected to a site.", {
				status: 404,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		return proxy(request, `https://${target}${url.pathname}${url.search}`);
	},
};

/**
 * Forward a request to the instance that owns it. A WebSocket upgrade (the
 * agent runtime's chat and browser-bridge sockets under /_emdash/agents/*) is
 * returned exactly as the origin answered it — rebuilding the 101 response
 * would drop the socket — everything else is re-wrapped so the edge can
 * re-encode the body for the client.
 */
async function proxy(
	request: Request,
	target: string,
	extra: Record<string, string> = {},
): Promise<Response> {
	const headers = new Headers(request.headers);
	headers.delete("host");
	for (const [k, v] of Object.entries(extra)) headers.set(k, v);
	const websocket = (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
		redirect: "manual",
	});
	if (websocket) return upstream;
	const out = new Headers(upstream.headers);
	out.delete("content-encoding");
	out.delete("content-length");
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
