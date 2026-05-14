/**
 * Pi Idle Notify Extension
 *
 * Sends a native notification and plays a sound when the agent becomes idle.
 * The notification includes the current project name and the session title.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { basename } from "node:path";

type TextBlock = { type: "text"; text: string };
type MessageEntry = {
	type: "message";
	message: {
		role: string;
		content?: string | TextBlock[];
	};
};

const DEFAULT_SESSION_TITLE = "Untitled session";
const MAX_TITLE_LENGTH = 120;

function truncate(value: string, maxLength = MAX_TITLE_LENGTH): string {
	const trimmed = value.replace(/\s+/g, " ").trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength - 1)}…`;
}

function appleScriptString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function powershellString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function terminalSafe(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f\u001b;]/g, " ").trim();
}

function getProjectName(ctx: ExtensionContext): string {
	return basename(ctx.cwd) || ctx.cwd || "unknown project";
}

function textFromContent(content: string | TextBlock[] | undefined): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;

	const text = content
		.filter((block): block is TextBlock => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join(" ");

	return text || undefined;
}

function getFirstUserMessageTitle(ctx: ExtensionContext): string | undefined {
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;

		const messageEntry = entry as MessageEntry;
		if (messageEntry.message.role !== "user") continue;

		const text = textFromContent(messageEntry.message.content);
		if (!text) continue;

		return truncate(text);
	}

	return undefined;
}

function getSessionTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const explicitName = pi.getSessionName() ?? ctx.sessionManager.getSessionName();
	if (explicitName) return truncate(explicitName);

	return getFirstUserMessageTitle(ctx) ?? DEFAULT_SESSION_TITLE;
}

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const manager = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText02`;
	const notification = `[${type}.ToastNotification]::new($xml)`;

	return [
		`${manager} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode(${powershellString(title)})) > $null`,
		`$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode(${powershellString(body)})) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('Pi').Show(${notification})`,
	].join("; ");
}

function notifyMac(title: string, body: string): void {
	const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)} sound name "Glass"`;
	execFile("osascript", ["-e", script], { timeout: 5000 }, () => {});
}

function notifyWindows(title: string, body: string): void {
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], { timeout: 5000 }, () => {});
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${terminalSafe(title)};${terminalSafe(body)}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=pi-idle:d=0;${terminalSafe(title)}\x1b\\`);
	process.stdout.write(`\x1b]99;i=pi-idle:p=body;${terminalSafe(body)}\x1b\\`);
}

function isWindowsLike(): boolean {
	return process.platform === "win32" || Boolean(process.env.WT_SESSION);
}

function playFallbackSound(): void {
	process.stdout.write("\x07");

	if (isWindowsLike()) {
		execFile("powershell.exe", ["-NoProfile", "-Command", "[console]::beep(880,250)"], { timeout: 3000 }, () => {});
	}
}

function notify(title: string, body: string): void {
	if (process.platform === "darwin") {
		notifyMac(title, body);
		return;
	}

	if (isWindowsLike()) {
		notifyWindows(title, body);
		playFallbackSound();
		return;
	}

	if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
		playFallbackSound();
		return;
	}

	notifyOSC777(title, body);
	playFallbackSound();
}

export default function idleNotify(pi: ExtensionAPI): void {
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.isIdle()) return;
		if (ctx.hasPendingMessages()) return;

		const projectName = getProjectName(ctx);
		const sessionTitle = getSessionTitle(pi, ctx);
		const title = `Pi idle — ${projectName}`;
		const body = `Session: ${sessionTitle}`;

		notify(title, body);
	});
}
