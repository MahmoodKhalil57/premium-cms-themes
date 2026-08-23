/**
 * Client-side helpers shared by the plugin frontends.
 *
 * `API` is the CMS base URL for browser requests: empty on the site's own
 * domain (PremiumCMS serves frontend and CMS together), `CMS_URL` when the
 * build is viewed elsewhere (GitHub Pages, localhost).
 */
import { CMS_URL } from "../config";

const offDomain = typeof location !== "undefined" && /(^|\.)github\.io$|^localhost$|^127\.|^0\.0\.0\.0$/.test(location.hostname);
export const API = offDomain ? CMS_URL : "";

/** Base URL of a plugin's public routes. */
export const pluginApi = (pluginId: string) => `${API}/_emdash/api/plugins/${pluginId}`;

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
