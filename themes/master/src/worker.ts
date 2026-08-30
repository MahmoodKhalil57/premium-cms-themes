import {
	BrowserBridge,
	handleAgentRequest,
	PluginAgent,
	Sandbox,
} from "@premium-cms/cloudflare/agents";
import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };
// The agent runtime (ctx.agents / ctx.sandbox for plugins), hosted by master itself.
export { BrowserBridge, PluginAgent, Sandbox };

const baseScheduled = createScheduledHandler();

/**
 * Master's scheduled handler runs EmDash's normal maintenance, then pokes the
 * Projects plugin's provisioning tick. The tick runs the CF-API provisioning
 * (create resources → deploy → attach domain → bootstrap owner) which needs a
 * full subrequest budget, so it must run in its own request — not inside the
 * content-save request (afterSave) and not as a sandboxed cron hook (the host
 * does not register those). A self-request to the plugin's public, secret-gated
 * `tick` route gives it that fresh invocation.
 */
export default {
	...handler,
	// The agent runtime's public endpoints first; everything else is EmDash.
	fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
		if (new URL(request.url).pathname.startsWith("/_emdash/agents/")) {
			const served = await handleAgentRequest(request, env as never);
			if (served) return served;
		}
		return (
			handler as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }
		).fetch(request, env, ctx);
	},
	scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(baseScheduled(event, env, ctx));
		const e = env as unknown as { TICK_TOKEN?: string; SELF?: { fetch: typeof fetch } };
		const token = e.TICK_TOKEN ?? "";
		if (!token || !e.SELF) return;
		try {
			// Self service-binding, not a public fetch: a Worker's subrequest to
			// its own custom domain does not reliably loop back, so drive the
			// tick through the SELF binding instead.
			await e.SELF.fetch(
				"https://master.premium-cms.com/_emdash/api/plugins/premiumcms-projects/tick",
				{
					method: "POST",
					headers: { Authorization: `Bearer ${token}`, "X-EmDash-Request": "1" },
				},
			);
		} catch {
			// A failed tick is retried on the next minute; never block maintenance.
		}
	},
};
