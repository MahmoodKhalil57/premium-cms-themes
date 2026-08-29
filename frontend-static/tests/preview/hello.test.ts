// The smallest possible `test:preview:cf`: the deployed preview answers with
// HTML. PREVIEW_URL is set by the platform's CI once the preview is live.
// Replace or extend with Playwright / Cloudflare Browser Rendering as needed —
// anything `bun test tests/preview` can run.
import { expect, test } from "bun:test";

const url = process.env.PREVIEW_URL ?? "";

test("preview is reachable", async () => {
	expect(url).toMatch(/^https:\/\//);
	const res = await fetch(url, { redirect: "follow" });
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type") ?? "").toContain("text/html");
	const html = await res.text();
	expect(html).toContain("<html");
});
