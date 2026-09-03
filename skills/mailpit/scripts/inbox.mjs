#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { basename } from "node:path";

const DEFAULT_MAILPIT_URL = "http://mailpit.tail4c22db.ts.net";
const DEFAULT_RECIPIENT_DOMAIN = "example.test";
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const POLL_INTERVAL_MS = 1000;

function configuredBaseUrl() {
	const value = process.env.MAILPIT_URL || DEFAULT_MAILPIT_URL;
	const url = new URL(value);
	if (!new Set(["http:", "https:"]).has(url.protocol)) {
		throw new Error("MAILPIT_URL must use HTTP or HTTPS.");
	}
	url.username = "";
	url.password = "";
	url.search = "";
	url.hash = "";
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}

function requestHeaders(url) {
	const username = process.env.MAILPIT_USERNAME;
	const password = process.env.MAILPIT_PASSWORD;
	if (Boolean(username) !== Boolean(password)) {
		throw new Error(
			"MAILPIT_USERNAME and MAILPIT_PASSWORD must be configured together.",
		);
	}
	if (!username) return {};
	const hostname = url.hostname.toLowerCase();
	const ipHostname = hostname.replace(/^\[|\]$/g, "");
	const loopback =
		hostname === "localhost" ||
		ipHostname === "::1" ||
		(isIP(ipHostname) === 4 && ipHostname.split(".")[0] === "127");
	const allowHttp = process.env.MAILPIT_ALLOW_HTTP_BASIC_AUTH === "true";
	if (url.protocol !== "https:" && !loopback && !allowHttp) {
		throw new Error(
			"Basic authentication requires HTTPS. Set MAILPIT_ALLOW_HTTP_BASIC_AUTH=true only for an encrypted private overlay.",
		);
	}
	return {
		authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
	};
}

function endpoint(path) {
	return new URL(path.replace(/^\//, ""), configuredBaseUrl());
}

async function request(pathOrUrl) {
	const url = pathOrUrl instanceof URL ? pathOrUrl : endpoint(pathOrUrl);
	const response = await fetch(url, {
		headers: requestHeaders(url),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Mailpit returned HTTP ${response.status}.`);
	}
	return response;
}

function options(values, supportedNames) {
	const result = {};
	const supported = new Set(supportedNames);
	for (let index = 0; index < values.length; index += 2) {
		const key = values[index];
		const value = values[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Options must use --name value pairs.");
		}
		const name = key.slice(2);
		if (!supported.has(name)) throw new Error(`Unknown option: ${key}.`);
		result[name] = value;
	}
	return result;
}

function recipientDomain() {
	const domain = process.env.MAILPIT_RECIPIENT_DOMAIN || DEFAULT_RECIPIENT_DOMAIN;
	if (!/^[a-z0-9.-]+$/i.test(domain) || !domain.includes(".")) {
		throw new Error("MAILPIT_RECIPIENT_DOMAIN is invalid.");
	}
	return domain.toLowerCase();
}

function projectSlug() {
	return (
		basename(process.cwd())
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 30) || "web"
	);
}

async function checkAccess() {
	await request("readyz");
	const info = await (await request("api/v1/info")).json();
	if (typeof info.Version !== "string") {
		throw new Error("Mailpit returned an invalid API information response.");
	}
	console.log(
		JSON.stringify({
			result: "success",
			url: configuredBaseUrl().toString().replace(/\/$/, ""),
			version: info.Version,
		}),
	);
}

function printNewIdentity() {
	const email = `${projectSlug()}-qa-${randomUUID()}@${recipientDomain()}`;
	console.log(
		JSON.stringify({
			email,
			checkpoint: encodeCheckpoint(email, []),
		}),
	);
}

function exactRecipients(message) {
	return [message.To, message.Cc, message.Bcc]
		.flatMap((value) => (Array.isArray(value) ? value : []))
		.map(({ Address }) => String(Address || "").toLowerCase());
}

function matchingMessages(payload, { to, seenIds, subject }) {
	const expectedRecipient = to.toLowerCase();
	return (Array.isArray(payload.messages) ? payload.messages : []).filter(
		(message) => {
			return (
				exactRecipients(message).includes(expectedRecipient) &&
				!seenIds.has(message.ID) &&
				(!subject || message.Subject === subject)
			);
		},
	);
}

function encodeCheckpoint(to, ids) {
	return Buffer.from(
		JSON.stringify({ version: 1, to: to.toLowerCase(), ids }),
	).toString("base64url");
}

function decodeCheckpoint(value, to) {
	if (!value) throw new Error("--after is required.");
	let checkpoint;
	try {
		checkpoint = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		throw new Error("--after is not a valid Mailpit checkpoint.");
	}
	if (
		checkpoint?.version !== 1 ||
		checkpoint.to !== to.toLowerCase() ||
		!Array.isArray(checkpoint.ids) ||
		!checkpoint.ids.every((id) => typeof id === "string")
	) {
		throw new Error("--after does not match this recipient.");
	}
	return new Set(checkpoint.ids);
}

function validateRecipient(value) {
	if (!value || !value.includes("@") || /[\s"\\]/.test(value)) {
		throw new Error("--to must be one email address.");
	}
	return value;
}

function searchUrl(to) {
	const search = endpoint("api/v1/search");
	search.searchParams.set("query", `to:\"${to}\"`);
	search.searchParams.set("limit", "100");
	return search;
}

async function printCheckpoint(values) {
	const parsed = options(values, ["to"]);
	const to = validateRecipient(parsed.to);
	const payload = await (await request(searchUrl(to))).json();
	const ids = (Array.isArray(payload.messages) ? payload.messages : [])
		.filter((message) => exactRecipients(message).includes(to.toLowerCase()))
		.map((message) => message.ID);
	console.log(JSON.stringify({ checkpoint: encodeCheckpoint(to, ids) }));
}

async function waitForEmail(values) {
	const parsed = options(values, ["to", "after", "subject"]);
	const to = validateRecipient(parsed.to);
	const seenIds = decodeCheckpoint(parsed.after, to);
	const search = searchUrl(to);
	const deadline = Date.now() + WAIT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const response = await request(search);
		const payload = await response.json();
		const matches = matchingMessages(payload, {
			to,
			seenIds,
			subject: parsed.subject,
		});
		if (matches.length > 1) {
			throw new Error(`Expected one matching email; received ${matches.length}.`);
		}
		if (matches.length === 1) {
			const id = matches[0].ID;
			const detail = await (await request(`api/v1/message/${encodeURIComponent(id)}`)).json();
			if (!exactRecipients(detail).includes(to.toLowerCase())) {
				throw new Error("Mailpit email recipient does not match the QA identity.");
			}
			console.log(
				JSON.stringify({
					id,
					viewUrl: endpoint(`view/${encodeURIComponent(id)}.html`).toString(),
					date: detail.Date,
					to: detail.To,
					cc: detail.Cc,
					bcc: detail.Bcc,
					from: detail.From,
					subject: detail.Subject,
					text: detail.Text,
					html: detail.HTML,
					attachments: detail.Attachments,
				}),
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error("Timed out after five minutes waiting for the Mailpit email.");
}

async function main() {
	const [command, ...values] = process.argv.slice(2);
	if (command === "check") return checkAccess();
	if (command === "new") return printNewIdentity();
	if (command === "checkpoint") return printCheckpoint(values);
	if (command === "wait") return waitForEmail(values);
	throw new Error(
		"Usage: inbox.mjs check | new | checkpoint --to EMAIL | wait --to EMAIL --after CHECKPOINT [--subject SUBJECT]",
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
