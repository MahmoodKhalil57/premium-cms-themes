// @ts-check
import { defineConfig } from "astro/config";
import baseLinks from "./src/base-links.mjs";

// Fully static build, deployed to GitHub Pages — no server logic. Content
// comes from the CMS's public /frontend-api feed at build time (see
// src/lib/emdash.ts), and the platform reverse-proxies the Pages build on
// the site's own domain.
//
// Project Pages live under /<repo> (user/org Pages at the root). The base is
// derived from GitHub Actions' own variables, or set explicitly with
// BASE_PATH; see src/base-links.mjs for how links get the prefix.
function pagesBase() {
	if (process.env.BASE_PATH) return process.env.BASE_PATH;
	const repo = process.env.GITHUB_REPOSITORY; // owner/name, always set in Actions
	if (!repo) return "/";
	const [owner, name] = repo.split("/");
	return name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? "/" : `/${name}`;
}

export default defineConfig({
	output: "static",
	base: pagesBase(),
	trailingSlash: "ignore",
	devToolbar: { enabled: false },
	integrations: [baseLinks()],
});
