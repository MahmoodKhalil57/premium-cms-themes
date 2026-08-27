import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@premium-cms/cloudflare";
import { cloudflareEmail } from "@premium-cms/cloudflare/plugins";
import { defineConfig } from "astro/config";
import emdash from "@premium-cms/emdash/astro";
import premiumcmsProjects from "@premium-cms/plugin-premiumcms-projects";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			// The Projects control plane runs IN-PROCESS (listed under `plugins`,
			// not `sandboxed`): provisioning makes many Cloudflare API calls and
			// waits on slow operations (D1 creation, bundle upload, child boot),
			// which the sandbox's 10-subrequest / 30s-wall-time / 50ms-CPU limits
			// forbid. It is our own first-party code on a trusted control-plane
			// instance, so in-process execution is appropriate.
			plugins: [
				cloudflareEmail({
					from: { email: "cms@send.premium-cms.com", name: "PremiumCMS Master" },
				}),
				premiumcmsProjects(),
			],
		}),
	],
	devToolbar: { enabled: false },
});
