/**
 * Astro integration: make the static build work under a sub-path
 * (GitHub project Pages: https://<owner>.github.io/<repo>/).
 *
 * Astro prefixes its own assets with `base`, but the theme and the CMS
 * (menus, page-builder HTML) produce root-relative links like `/posts/x`.
 * After the build, every root-relative URL in the generated HTML gets the
 * base prefix. PremiumCMS's proxy strips it again on the site's own domain,
 * so the same build serves both URLs.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ATTRS = ["href", "src", "action", "poster", "data-src", "content"];

export default function baseLinks() {
	let configuredBase = "/";
	return {
		name: "premiumcms-base-links",
		hooks: {
			"astro:config:done": ({ config }) => {
				configuredBase = config.base || "/";
			},
			"astro:build:done": async ({ dir, logger }) => {
				const base = configuredBase.replace(/\/+$/, "");
				if (!base) return;
				const root = dir instanceof URL ? decodeURIComponent(dir.pathname) : String(dir);
				const files = [];
				const walk = async (d) => {
					for (const e of await readdir(d, { withFileTypes: true })) {
						const p = join(d, e.name);
						if (e.isDirectory()) await walk(p);
						else if (e.name.endsWith(".html")) files.push(p);
					}
				};
				await walk(root);
				const attr = new RegExp(`\\b(${ATTRS.join("|")})="(/(?!/)[^"]*)"`, "g");
				const srcset = /\bsrcset="([^"]*)"/g;
				let count = 0;
				for (const f of files) {
					const html = await readFile(f, "utf8");
					const out = html
						.replace(attr, (m, name, url) => (url.startsWith(base + "/") || url === base ? m : `${name}="${base}${url}"`))
						.replace(srcset, (m, list) => `srcset="${list.replace(/(^|,\s*)(\/(?!\/)[^\s,]*)/g, (mm, pre, url) => (url.startsWith(base + "/") ? mm : `${pre}${base}${url}`))}"`);
					if (out !== html) {
						await writeFile(f, out);
						count++;
					}
				}
				logger.info(`base-links: prefixed root-relative URLs with ${base} in ${count} file(s)`);
			},
		},
	};
}
