/**
 * Layout data + slot filling for the site chrome (PremiumCMS frontend).
 *
 * The header and footer are CMS SECTIONS (slugs `site-header` / `site-footer`)
 * — designer-editable page-builder blocks managed in the admin. Their HTML
 * carries EMPTY marker elements that this module fills at build time:
 *
 *   <nav data-menu="primary"></nav>          ← links from the Menus manager
 *   <div data-widget-area="footer"></div>    ← widgets from the Widgets manager
 *   <div data-theme-switcher></div>          ← the built-in theme switcher
 *
 * Markers must be empty; designers move and restyle the containers freely,
 * the CMS owns what goes inside them.
 */
import { fetchLayoutData } from "./emdash";
import type { PortableTextBlock } from "./emdash";
import { esc, renderPortableText } from "./pt";

export interface MenuItem {
	label: string;
	url: string;
	target?: string;
}

export interface SiteKitConfig {
	analytics: { ga4Id: string | null; gtmId: string | null; cfBeaconToken: string | null; searchConsoleToken: string | null };
	consent: { title: string; text: string; privacyUrl: string } | null;
	business: Record<string, unknown> | null;
	reviewsConfigured: boolean;
}

export interface LayoutData {
	siteKit: SiteKitConfig | null;
	menus: Record<string, { label?: string; items: MenuItem[] }>;
	widgetAreas: Record<
		string,
		{ label?: string; widgets: Array<{ type: string; title?: string; content?: PortableTextBlock[]; menuName?: string }> }
	>;
	sections: Record<string, { title?: string; content: PortableTextBlock[] }>;
}

const EMPTY: LayoutData = { siteKit: null, menus: {}, widgetAreas: {}, sections: {} };

export async function getLayout(): Promise<LayoutData> {
	const data = await fetchLayoutData();
	if (!data) return EMPTY;
	return { siteKit: (data.siteKit as SiteKitConfig | undefined) ?? null, menus: (data.menus as LayoutData["menus"] | undefined) ?? {}, widgetAreas: (data.widgetAreas as LayoutData["widgetAreas"] | undefined) ?? {}, sections: (data.sections as LayoutData["sections"] | undefined) ?? {} };
}

function menuLinks(items: MenuItem[]): string {
	return items
		.map(
			(item) =>
				`<a href="${esc(item.url)}"${item.target === "_blank" ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(item.label)}</a>`,
		)
		.join("");
}

function widgetHtml(
	widget: { type: string; title?: string; content?: PortableTextBlock[]; menuName?: string },
	layout: LayoutData,
): string {
	const title = widget.title ? `<h4 class="widget-title">${esc(widget.title)}</h4>` : "";
	if (widget.type === "content") {
		return `<div class="widget widget-content">${title}${renderPortableText(widget.content)}</div>`;
	}
	if (widget.type === "menu" && widget.menuName && layout.menus[widget.menuName]) {
		return `<div class="widget widget-menu">${title}<nav>${menuLinks(layout.menus[widget.menuName].items)}</nav></div>`;
	}
	return "";
}

const THEME_SWITCHER_HTML = `<div class="theme-switcher">
<button type="button" class="theme-btn" data-theme="light" aria-label="Light mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg></button>
<button type="button" class="theme-btn" data-theme="dark" aria-label="Dark mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></button>
<button type="button" class="theme-btn" data-theme="system" aria-label="System theme"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg></button>
</div>`;

export interface SiteIdentity {
	title?: string;
	tagline?: string;
}

/** Fill empty [data-menu] / [data-widget-area] / [data-theme-switcher] /
 *  [data-site-title] / [data-site-tagline] markers. */
export function fillLayoutSlots(html: string, layout: LayoutData, site?: SiteIdentity): string {
	return html
		.replace(/<([a-z][a-z0-9-]*)([^>]*\bdata-menu="([^"]+)"[^>]*)>\s*<\/\1>/g, (match, tag, attrs, name) => {
			const menu = layout.menus[name];
			return menu ? `<${tag}${attrs}>${menuLinks(menu.items)}</${tag}>` : match;
		})
		.replace(/<([a-z][a-z0-9-]*)([^>]*\bdata-widget-area="([^"]+)"[^>]*)>\s*<\/\1>/g, (match, tag, attrs, name) => {
			const area = layout.widgetAreas[name];
			return area
				? `<${tag}${attrs}>${area.widgets.map((w) => widgetHtml(w, layout)).join("")}</${tag}>`
				: match;
		})
		.replace(/<([a-z][a-z0-9-]*)([^>]*\bdata-theme-switcher\b[^>]*)>\s*<\/\1>/g, (_match, tag, attrs) => {
			return `<${tag}${attrs}>${THEME_SWITCHER_HTML}</${tag}>`;
		})
		.replace(/<([a-z][a-z0-9-]*)([^>]*\bdata-site-title\b[^>]*)>\s*<\/\1>/g, (_match, tag, attrs) => {
			return `<${tag}${attrs}>${esc(site?.title ?? "")}</${tag}>`;
		})
		.replace(/<([a-z][a-z0-9-]*)([^>]*\bdata-site-tagline\b[^>]*)>\s*<\/\1>/g, (_match, tag, attrs) => {
			return `<${tag}${attrs}>${esc(site?.tagline ?? "")}</${tag}>`;
		});
}

/** Render a layout section (header/footer) with its slots filled. */
export function renderLayoutSection(
	layout: LayoutData,
	slug: string,
	site?: SiteIdentity,
): string | null {
	const section = layout.sections[slug];
	if (!section || !Array.isArray(section.content) || section.content.length === 0) return null;
	return fillLayoutSlots(renderPortableText(section.content), layout, site);
}
