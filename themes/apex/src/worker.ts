import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };

const baseScheduled = createScheduledHandler();

export default {
	...handler,
	scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(baseScheduled(event, env, ctx));
		const e = env as unknown as { TICK_TOKEN?: string; SELF?: { fetch: typeof fetch } };
		const token = e.TICK_TOKEN ?? "";
		if (!token || !e.SELF) return;
		try {
			// Self service-binding, not a public fetch: a Worker's subrequest to
			// its own custom domain does not reliably loop back.
			await e.SELF.fetch("https://premium-cms.com/_emdash/api/plugins/premiumcms-projects/tick", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "X-EmDash-Request": "1" },
			});
		} catch {
			// Retried next minute; never block maintenance.
		}
	},
};
