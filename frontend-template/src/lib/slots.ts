/**
 * Content markers for designed pages. A page-builder design drops an empty
 * element with one of these attributes where dynamic content goes; the theme
 * fills it at render time with the same markup its built-in pages use:
 *
 *   data-featured-post                     newest post with an image
 *   data-posts-grid [data-limit] [data-skip-featured]   card grid of latest posts
 *   data-posts-list [data-limit]           archive rows
 *   data-posts-count                       "12 articles"
 *   data-product-grid                      shop grid (featured first)
 *
 * Layout markers (data-menu, data-widget-area, data-site-title, …) are
 * handled by fillLayoutSlots; fillAllSlots runs both.
 */
import { byNewest, featuredPostHtml, postCardHtml, postListItemHtml, productCardHtml } from "./cards";
import { getEmDashCollection, getTermsForEntries } from "./emdash";
import { fillLayoutSlots, getLayout, type LayoutData, type SiteIdentity } from "./layout";

/** Page slugs that the theme renders at their own URL instead of /pages/<slug>. */
export const ROUTE_PAGES = new Set(["home", "posts", "products", "cart", "checkout-success", "404"]);

const MARKER = (name: string) => new RegExp(`<([a-z][a-z0-9-]*)([^>]*\\b${name}\\b[^>]*)>\\s*</\\1>`, "g");
const attr = (attrs: string, name: string): string | null => {
	const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
	return m ? m[1] : null;
};

export async function fillContentSlots(html: string): Promise<string> {
	if (!/data-(featured-post|posts-grid|posts-list|posts-count|product-grid)\b/.test(html)) return html;
	let out = html;
	if (/data-(featured-post|posts-grid|posts-list|posts-count)\b/.test(html)) {
		const { entries } = await getEmDashCollection("posts");
		const posts = [...entries].sort(byNewest);
		const tagsByEntry = await getTermsForEntries("posts", posts.map((p) => p.data.id), "tag");
		const tags = (p: { data: { id: string } }) => tagsByEntry.get(p.data.id) ?? [];
		const featured = posts.find((p) => p.data.featured_image) ?? null;
		out = out
			.replace(MARKER("data-featured-post"), (_m, tag, attrs) => `<${tag}${attrs}>${featured ? featuredPostHtml(featured, tags(featured)) : ""}</${tag}>`)
			.replace(MARKER("data-posts-grid"), (_m, tag, attrs) => {
				const limit = Number(attr(attrs, "data-limit") ?? 6) || 6;
				const skip = /\bdata-skip-featured\b/.test(attrs) && featured ? featured : null;
				const list = posts.filter((p) => p !== skip).slice(0, limit);
				return `<${tag}${attrs}>${list.map((p) => postCardHtml(p, tags(p))).join("")}</${tag}>`;
			})
			.replace(MARKER("data-posts-list"), (_m, tag, attrs) => {
				const limit = Number(attr(attrs, "data-limit") ?? 0) || posts.length;
				return `<${tag}${attrs}>${posts.slice(0, limit).map((p) => postListItemHtml(p, tags(p))).join("")}</${tag}>`;
			})
			.replace(MARKER("data-posts-count"), (_m, tag, attrs) => `<${tag}${attrs}>${posts.length} ${posts.length === 1 ? "article" : "articles"}</${tag}>`);
	}
	if (/data-product-grid\b/.test(html)) {
		const { entries } = await getEmDashCollection("products");
		const featured = entries.filter((p) => p.data.fields.featured);
		const rest = entries.filter((p) => !p.data.fields.featured);
		out = out.replace(MARKER("data-product-grid"), (_m, tag, attrs) => `<${tag}${attrs}>${[...featured, ...rest].map(productCardHtml).join("")}</${tag}>`);
	}
	return out;
}

/** Layout markers + content markers, in one go. */
export async function fillAllSlots(html: string, site?: SiteIdentity, layout?: LayoutData): Promise<string> {
	const l = layout ?? (await getLayout());
	return fillContentSlots(fillLayoutSlots(html, l, site));
}
