import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };

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
	scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(baseScheduled(event, env, ctx));
		const token = (env as unknown as { TICK_TOKEN?: string }).TICK_TOKEN ?? "";
		if (!token) return;
		try {
			await fetch("https://master.premium-cms.com/_emdash/api/plugins/premiumcms-projects/tick", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "X-EmDash-Request": "1" },
			});
		} catch {
			// A failed tick is retried on the next minute; never block maintenance.
		}
	},
};
