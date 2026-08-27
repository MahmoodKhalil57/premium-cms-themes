import handler, { createScheduledHandler, PluginBridge } from "@premium-cms/cloudflare/worker";

export { PluginBridge };

export default {
	...handler,
	scheduled: createScheduledHandler(),
};
