import { describe, expect, mock, test } from "bun:test";

const STALE_CONTEXT_ERROR =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().";

mock.module("@earendil-works/pi-coding-agent", () => ({
	CustomEditor: class {},
}));

const { default: forceQueuedOnEnter } = await import("../extensions/force-queued-on-enter.ts");

type Handler = (event: unknown, ctx: unknown) => unknown;

type ContextProbe = {
	ctx: unknown;
	modeReads: number;
	editorReplacements: number;
	invalidateOnModeRead: () => void;
};

class Harness {
	readonly handlers = new Map<string, Handler[]>();
	readonly pi = {
		on: (event: string, handler: Handler) => {
			this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
		},
		sendUserMessage: (_text: string) => undefined,
	};

	constructor() {
		forceQueuedOnEnter(this.pi as never);
	}

	emitSync(event: string, ctx: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) handler({}, ctx);
	}
}

function context(harness: Harness, options: { invalidateOnModeRead?: boolean } = {}): ContextProbe {
	let modeReads = 0;
	let editorReplacements = 0;
	let invalidateOnModeRead = options.invalidateOnModeRead === true;

	const probe: ContextProbe = {
		ctx: undefined,
		get modeReads() {
			return modeReads;
		},
		get editorReplacements() {
			return editorReplacements;
		},
		invalidateOnModeRead: () => {
			invalidateOnModeRead = true;
		},
	};

	probe.ctx = {
		get mode() {
			modeReads++;
			if (invalidateOnModeRead) {
				harness.emitSync("session_shutdown", probe.ctx);
				throw new Error(STALE_CONTEXT_ERROR);
			}
			return "tui";
		},
		hasUI: true,
		ui: {
			getEditorComponent: () => undefined,
			setEditorComponent: () => {
				editorReplacements++;
			},
		},
	};

	return probe;
}

describe("force-queued-on-enter extension lifecycle", () => {
	test("does not access or replace an editor from a session_start after shutdown", async () => {
		const harness = new Harness();
		const stale = context(harness);

		harness.emitSync("session_start", stale.ctx);
		harness.emitSync("session_shutdown", stale.ctx);
		await Promise.resolve();

		expect(stale.modeReads).toBe(0);
		expect(stale.editorReplacements).toBe(0);
	});

	test("ignores a deferred install from a replaced session generation", async () => {
		const harness = new Harness();
		const oldSession = context(harness);
		const newSession = context(harness);

		harness.emitSync("session_start", oldSession.ctx);
		harness.emitSync("session_start", newSession.ctx);
		await Promise.resolve();

		expect(oldSession.modeReads).toBe(0);
		expect(oldSession.editorReplacements).toBe(0);
		expect(newSession.editorReplacements).toBe(1);
	});

	test("fails closed if shutdown races the first context access", async () => {
		const harness = new Harness();
		const raced = context(harness, { invalidateOnModeRead: true });

		harness.emitSync("session_start", raced.ctx);
		await Promise.resolve();

		expect(raced.modeReads).toBe(1);
		expect(raced.editorReplacements).toBe(0);
	});
});
