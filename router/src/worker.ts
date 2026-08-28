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

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const host = url.hostname.toLowerCase();
		const target = await env.DOMAINS.get(host);
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
		const headers = new Headers(request.headers);
		headers.delete("host");
		const upstream = await fetch(`https://${target}${url.pathname}${url.search}`, {
			method: request.method,
			headers,
			body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
			redirect: "manual",
		});
		const out = new Headers(upstream.headers);
		out.delete("content-encoding");
		out.delete("content-length");
		return new Response(upstream.body, { status: upstream.status, headers: out });
	},
};
