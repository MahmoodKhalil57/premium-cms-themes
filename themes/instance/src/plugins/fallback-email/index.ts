/**
 * Fallback email provider (inline, template-local, TRUSTED).
 *
 * Sends transactional email (magic links, invites) through the Cloudflare Email
 * Sending REST API using credentials the platform passes to this instance as
 * Worker secrets — the projects plugin's "fallback email" settings. This lets a
 * freshly provisioned site send email (so magic-link login works) before its
 * owner configures their own provider, and works even when the site is
 * provisioned onto a different Cloudflare account than the fallback email
 * account.
 *
 * Registered as the exclusive `email:deliver` provider. It is a trusted
 * definePlugin (not sandboxed) so its exclusive hook actually registers — a
 * sandboxed plugin's email:deliver hook never becomes the selected provider.
 *
 * Secrets read (set per-instance by premiumcms-projects at provision time):
 *   EMAIL_FALLBACK_ACCOUNT_ID   Cloudflare account id (Email Sending onboarded)
 *   EMAIL_FALLBACK_API_TOKEN    token with Email:Send
 *   EMAIL_FALLBACK_FROM         sender address (its domain onboarded)
 *   EMAIL_FALLBACK_FROM_NAME    optional sender name
 */

import { definePlugin } from "@premium-cms/emdash";
import type { EmailDeliverEvent, PluginContext } from "@premium-cms/emdash/plugin";
import type { ResolvedPlugin } from "@premium-cms/emdash";

interface Env {
	EMAIL_FALLBACK_ACCOUNT_ID?: string;
	EMAIL_FALLBACK_API_TOKEN?: string;
	EMAIL_FALLBACK_FROM?: string;
	EMAIL_FALLBACK_FROM_NAME?: string;
}

async function loadEnv(): Promise<Env> {
	const mod = await import("cloudflare:workers");
	return mod.env as unknown as Env;
}

async function deliver(event: EmailDeliverEvent, ctx: PluginContext): Promise<void> {
	const env = await loadEnv();
	const acct = (env.EMAIL_FALLBACK_ACCOUNT_ID ?? "").trim();
	const token = (env.EMAIL_FALLBACK_API_TOKEN ?? "").trim();
	const fromAddr = (env.EMAIL_FALLBACK_FROM ?? "").trim();
	if (!acct || !token || !fromAddr) {
		throw new Error(
			"[fallback-email] not configured — set the fallback email account, token and sender on the projects plugin settings.",
		);
	}
	const { message } = event;
	const payload: Record<string, unknown> = {
		to: message.to,
		from: env.EMAIL_FALLBACK_FROM_NAME
			? { address: fromAddr, name: env.EMAIL_FALLBACK_FROM_NAME }
			: { address: fromAddr },
		subject: message.subject,
		text: message.text,
	};
	if (message.html) payload.html = message.html;

	const res = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${acct}/email/sending/send`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		},
	);
	const body = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		errors?: Array<{ code?: number; message?: string }>;
	};
	if (!res.ok || body.success === false) {
		const detail =
			(body.errors ?? [])
				.map((e) => e.message)
				.filter(Boolean)
				.join("; ") || `HTTP ${res.status}`;
		throw new Error(`[fallback-email] send failed for ${message.to} — ${detail}`);
	}
	ctx.log.info("email delivered via fallback provider (Cloudflare Email Sending REST)", {
		to: message.to,
		subject: message.subject,
	});
}

export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: "fallback-email",
		version: "0.1.0",
		capabilities: ["hooks.email-transport:register"],
		hooks: {
			"email:deliver": { exclusive: true, handler: deliver },
		},
	});
}

export default createPlugin;
