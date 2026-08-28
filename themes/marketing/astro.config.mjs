import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@premium-cms/cloudflare";
import { cloudflareEmail } from "@premium-cms/cloudflare/plugins";
import cloudflareEmailByo from "@premium-cms/plugin-cloudflare-email-byo";
import { formsPlugin } from "@premium-cms/plugin-forms";
import premiumcmsProjects from "@premium-cms/plugin-premiumcms-projects";
import webhookNotifier from "@premium-cms/plugin-webhook-notifier";
import icon from "astro-iconset";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "@premium-cms/emdash/astro";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	vite: {
		ssr: {
			optimizeDeps: {
				// Pre-bundle so it isn't discovered mid-render, which would trigger
				// a Vite dep re-optimization and break in-flight worker imports
				// under the Cloudflare dev runner (workerd).
				include: ["astro-iconset/components"],
			},
		},
	},
	integrations: [
		react(),
		icon({
			// Only ship the Phosphor icons actually referenced in templates,
			// not the full @iconify-json/ph set (which adds megabytes to the
			// deployed worker bundle).
			include: {
				ph: [
					"chart-bar",
					"check-circle",
					"clock",
					"cloud",
					"code",
					"currency-dollar",
					"envelope",
					"globe",
					"heart",
					"lifebuoy",
					"lightning",
					"lock",
					"shield-check",
					"sparkle",
					"star",
					"users-three",
				],
			},
		}),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [
				{
					id: "marketing-blocks",
					version: "0.1.0",
					// Absolute file:// URL so the virtual emdash/plugins module
					// can resolve this at build time (relative paths fail because
					// the virtual module has no on-disk location to anchor them).
					entrypoint: new URL("./src/plugins/marketing-blocks/index.ts", import.meta.url).href,
				},
				// Platform email via this Worker's send_email binding (the platform's
				// Cloudflare account, sending from the onboarded send.premium-cms.com).
				// No per-instance token needed — identical to apex — so magic-link
				// login works out of the box before an owner configures their own.
				cloudflareEmail({
					from: { email: "cms@send.premium-cms.com", name: "PremiumCMS" },
				}),
				formsPlugin(),
				// Control-plane plugin, in-process (provisioning exceeds sandbox
				// limits). Inert on leaf instances (no Cloudflare credentials, no
				// `projects` collection); it turns any instance into a platform
				// when configured, so every instance ships an identical backend.
				premiumcmsProjects(),
			],
			// Sandboxed extras: webhook notifications + a bring-your-own email
			// provider the owner can configure. Both inert until set up.
			sandboxed: [webhookNotifier, cloudflareEmailByo],
			// The site owner can browse and install marketplace plugins/themes.
			// Marketplace installs run in the sandbox, so a sandboxRunner is required.
			sandboxRunner: sandbox(),
			marketplace: "https://marketplace.premium-cms.com",
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700, 800],
			fallbacks: ["sans-serif"],
		},
	],
	devToolbar: { enabled: false },
});
