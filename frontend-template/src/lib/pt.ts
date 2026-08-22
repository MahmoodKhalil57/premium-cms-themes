/**
 * Portable Text → HTML for build-time rendering (PremiumCMS frontend).
 * Supports the block shapes the CMS produces: normal/h2/h3/blockquote
 * paragraphs, span marks (strong, em, code), link markDefs, raw htmlBlock,
 * and grapesBlock (sections designed with the admin page builder — rendered
 * as their stored html + css, same trust model as the CMS itself).
 */
import type { PortableTextBlock } from "./emdash";

export function esc(s: unknown): string {
	return String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Span {
	_type: string;
	text?: string;
	marks?: string[];
}

interface MarkDef {
	_key: string;
	_type: string;
	href?: string;
}

function renderSpan(span: Span, markDefs: MarkDef[]): string {
	let html = esc(span.text ?? "");
	for (const mark of span.marks ?? []) {
		if (mark === "strong") html = `<strong>${html}</strong>`;
		else if (mark === "em") html = `<em>${html}</em>`;
		else if (mark === "code") html = `<code>${html}</code>`;
		else {
			const def = markDefs.find((d) => d._key === mark);
			if (def?._type === "link" && def.href && /^https?:\/\//.test(def.href)) {
				html = `<a href="${esc(def.href)}" rel="noopener noreferrer">${html}</a>`;
			} else if (def?._type === "link" && def.href?.startsWith("/")) {
				html = `<a href="${esc(def.href)}">${html}</a>`;
			}
		}
	}
	return html;
}

const TAG: Record<string, string> = { normal: "p", h2: "h2", h3: "h3", h4: "h4", blockquote: "blockquote" };

export function renderPortableText(blocks: PortableTextBlock[] | undefined): string {
	if (!blocks || !Array.isArray(blocks)) return "";
	const out: string[] = [];
	let list: string[] | null = null;
	let listTag = "ul";

	const flushList = () => {
		if (list) {
			out.push(`<${listTag}>${list.join("")}</${listTag}>`);
			list = null;
		}
	};

	for (const block of blocks) {
		if (block._type === "htmlBlock") {
			flushList();
			const b = block as { html?: string };
			if (b.html) out.push(`<div class="html-block">${b.html}</div>`);
			continue;
		}
		if (block._type === "grapesBlock") {
			flushList();
			const b = block as { html?: string; css?: string; editCss?: string };
			if (b.html) {
				const styles = [b.css, b.editCss].filter(Boolean).join("\n");
				out.push(`<div class="grapes-block">${styles ? `<style>${styles}</style>` : ""}${b.html}</div>`);
			}
			continue;
		}
		if (block._type !== "block") continue;
		const markDefs = (block.markDefs as MarkDef[] | undefined) ?? [];
		const inner = ((block.children as Span[] | undefined) ?? [])
			.filter((c) => c._type === "span")
			.map((c) => renderSpan(c, markDefs))
			.join("");
		const listItem = (block as { listItem?: string }).listItem;
		if (listItem) {
			const tag = listItem === "number" ? "ol" : "ul";
			if (!list || listTag !== tag) {
				flushList();
				list = [];
				listTag = tag;
			}
			list.push(`<li>${inner}</li>`);
			continue;
		}
		flushList();
		const style = String(block.style ?? "normal");
		const tag = TAG[style] ?? "p";
		out.push(`<${tag}>${inner}</${tag}>`);
	}
	flushList();
	return out.join("\n");
}
