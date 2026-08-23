/**
 * HTML for the theme's repeating pieces — post cards, the featured post,
 * archive rows. (Product cards live in the Commerce plugin frontend.) One source for the Astro components AND the
 * page-builder markers (`data-posts-grid` etc.), so a designed page and the
 * built-in defaults render the same markup.
 */
import { CMS_URL } from "../config";
import type { Entry, MediaValue, Term } from "./emdash";
import { esc } from "./pt";
import { getReadingTime } from "../utils/reading-time";

export function mediaUrl(media: MediaValue | string | null | undefined): string | null {
	let m: MediaValue | null = null;
	if (typeof media === "string") {
		try {
			m = JSON.parse(media) as MediaValue;
		} catch {
			return null;
		}
	} else m = media ?? null;
	if (!m) return null;
	if (m.src && /^https?:\/\//.test(m.src)) return m.src;
	const key = m.meta?.storageKey ?? m.id;
	return key ? `${CMS_URL}/_emdash/api/media/file/${key}` : null;
}

export function imageHtml(media: MediaValue | string | null | undefined, loading: "lazy" | "eager" = "lazy"): string {
	const src = mediaUrl(media);
	if (!src) return "";
	const m = (typeof media === "string" ? null : media) as MediaValue | null;
	const size = m?.width && m?.height ? ` width="${m.width}" height="${m.height}"` : "";
	return `<img src="${esc(src)}" alt="${esc(m?.alt ?? "")}"${size} loading="${loading}">`;
}

const longDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : null);
const shortDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null);

export function postCardHtml(post: Entry, tags: Term[] = []): string {
	const date = shortDate(post.data.publishedAt);
	const minutes = getReadingTime(post.data.content);
	const img = post.data.featured_image ? `<div class="card-image">${imageHtml(post.data.featured_image)}</div>` : `<div class="card-placeholder"></div>`;
	const meta = [date ? `<time>${esc(date)}</time>` : "", date && minutes ? `<span class="meta-dot"></span>` : "", minutes ? `<span>${minutes} min</span>` : ""].join("");
	const tagHtml = tags.length ? `<div class="card-tags">${tags.slice(0, 2).map((t) => `<a href="/tag/${esc(t.slug)}" class="card-tag">${esc(t.label)}</a>`).join("")}</div>` : "";
	return `<article class="post-card"><a href="/posts/${esc(post.id)}" class="card-link">${img}<div class="card-body"><div class="card-meta">${meta}</div><h2 class="card-title">${esc(post.data.title ?? "Untitled")}</h2>${post.data.excerpt ? `<p class="card-excerpt">${esc(post.data.excerpt)}</p>` : ""}</div></a>${tagHtml}</article>`;
}

export function featuredPostHtml(post: Entry, tags: Term[] = []): string {
	const date = longDate(post.data.publishedAt);
	const minutes = getReadingTime(post.data.content);
	return `<section class="featured-section"><div class="featured-grid"><a href="/posts/${esc(post.id)}" class="featured-image-link"><div class="featured-image">${imageHtml(post.data.featured_image, "eager")}</div></a><div class="featured-content"><div class="featured-meta">${date ? `<time>${esc(date)}</time>` : ""}<span class="meta-dot"></span><span>${minutes} min read</span></div><a href="/posts/${esc(post.id)}" class="featured-title-link"><h1 class="featured-title">${esc(post.data.title ?? "Untitled")}</h1></a>${post.data.excerpt ? `<p class="featured-excerpt">${esc(post.data.excerpt)}</p>` : ""}${tags.length ? `<div class="featured-tags">${tags.map((t) => `<a href="/tag/${esc(t.slug)}" class="featured-tag">${esc(t.label)}</a>`).join("")}</div>` : ""}</div></div></section>`;
}

export function postListItemHtml(post: Entry, tags: Term[] = []): string {
	const date = longDate(post.data.publishedAt);
	const minutes = getReadingTime(post.data.content);
	const meta = [date ? `<time>${esc(date)}</time><span class="meta-dot"></span>` : "", `<span>${minutes} min read</span>`].join("");
	const tagHtml = tags.length ? `<div class="post-tags">${tags.slice(0, 3).map((t) => `<a href="/tag/${esc(t.slug)}" class="post-tag">${esc(t.label)}</a>`).join("")}</div>` : "";
	return `<article class="post-item"><a href="/posts/${esc(post.id)}" class="post-link"><div class="post-meta">${meta}</div><h2 class="post-title">${esc(post.data.title ?? "Untitled")}</h2>${post.data.excerpt ? `<p class="post-excerpt">${esc(post.data.excerpt)}</p>` : ""}</a>${tagHtml}</article>`;
}

export const byNewest = (a: Entry, b: Entry) => (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0);
