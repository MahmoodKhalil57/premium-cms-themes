import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@premium-cms/cloudflare";
import { cloudflareEmail } from "@premium-cms/cloudflare/plugins";
import { formsPlugin } from "@premium-cms/plugin-forms";
import cloudflareEmailByo from "@premium-cms/plugin-cloudflare-email-byo";
import webhookNotifier from "@premium-cms/plugin-webhook-notifier";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "@premium-cms/emdash/astro";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [
				formsPlugin(),
				// Sends from the dedicated sending subdomain rather than the apex
				// domain, so transactional delivery cannot affect the reputation
				// of mail sent from premium-cms.com itself.
				cloudflareEmail({
					from: { email: "cms@send.premium-cms.com", name: "PremiumCMS" },
				}),
			],
			// Two email providers are installed on purpose: cloudflareEmail sends
			// through this Worker's send_email binding (the platform's Cloudflare
			// account), cloudflareEmailByo sends through credentials the site
			// owner enters in the admin (their account, their domain, their
			// quota). EmDash auto-selects a provider only when exactly one is
			// active, so with both present the choice is explicit under
			// Settings → Email.
			sandboxed: [webhookNotifier, cloudflareEmailByo],
			sandboxRunner: sandbox(),
			marketplace: "https://marketplace.premium-cms.com",
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
