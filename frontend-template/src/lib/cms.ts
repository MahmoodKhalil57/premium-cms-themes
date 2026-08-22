/**
 * Platform hook — the one place where the two hosting modes differ.
 *
 * On GitHub Pages this frontend is fully static, so there is nothing to add.
 * When PremiumCMS hosts the same code itself, the platform swaps this file for
 * one that renders EmDash's page contributions (SEO tags, the editing toolbar
 * for signed-in editors, plugin fragments). Pages call it through Base.astro
 * and never need to know which mode they run in.
 */

export interface CmsPage {
	title: string;
	description?: string | null;
	image?: string | null;
	canonical?: string | null;
	type?: "website" | "article";
	content?: { collection: string; id: string; slug?: string | null };
}

export interface CmsFragments {
	head: string;
	bodyStart: string;
	bodyEnd: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature shared with the platform implementation
export async function cmsFragments(_astro: unknown, _page: CmsPage): Promise<CmsFragments> {
	return { head: "", bodyStart: "", bodyEnd: "" };
}
