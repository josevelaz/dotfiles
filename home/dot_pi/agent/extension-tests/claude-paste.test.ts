import { describe, expect, mock, test } from "bun:test";
import {
	createRepeatedPasteProbe,
	endsBracketedPaste,
	formatRenderedPasteMarkers,
	shouldExpandRepeatedPaste,
	startsBracketedPaste,
} from "../lib/claude-paste/logic.ts";

const STALE_CONTEXT_ERROR =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().";

mock.module("@earendil-works/pi-coding-agent", () => ({
	CustomEditor: class {},
}));

const {
	default: claudePaste,
	installClaudePasteEditorFactory,
	wrapEditorForClaudePaste,
} = await import("../extensions/claude-paste.ts");

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

describe("Claude paste transition logic", () => {
	test("captures the content represented by a trailing marker", () => {
		expect(
			createRepeatedPasteProbe(
				"before [paste #1 +42 lines]",
				"before full\npaste\ntext",
				true,
			),
		).toEqual({
			expandedText: "before full\npaste\ntext",
			pastedText: "full\npaste\ntext",
		});
	});

	test("rejects drafts without one safe trailing marker", () => {
		expect(createRepeatedPasteProbe("before", "before", true)).toBeUndefined();
		expect(
			createRepeatedPasteProbe("[paste #1 +42 lines] after", "full after", true),
		).toBeUndefined();
		expect(
			createRepeatedPasteProbe("[paste #1 +42 lines]", "full", false),
		).toBeUndefined();
		expect(
			createRepeatedPasteProbe(
				"[paste #1 +42 lines]",
				"literal [paste #1 +9 lines]",
				true,
			),
		).toBeUndefined();
	});

	test("recognizes only the same content appended by the next paste", () => {
		const probe = { expandedText: "before full", pastedText: "full" };
		expect(shouldExpandRepeatedPaste(probe, "before fullfull")).toBe(true);
		expect(shouldExpandRepeatedPaste(probe, "before fulldifferent")).toBe(false);
	});

	test("detects bracketed paste boundaries inside combined input chunks", () => {
		expect(startsBracketedPaste(`prefix\x1b[200~body`)).toBe(true);
		expect(endsBracketedPaste(`body\x1b[201~suffix`)).toBe(true);
		expect(startsBracketedPaste("ordinary input")).toBe(false);
		expect(endsBracketedPaste("ordinary input")).toBe(false);
	});
});

describe("Claude paste marker presentation", () => {
	test("formats line and character markers", () => {
		expect(formatRenderedPasteMarkers("[paste #1 +42 lines]")).toBe("[Pasted 42 lines]");
		expect(formatRenderedPasteMarkers("[paste #2 1400 chars]")).toBe(
			"[Pasted 1400 chars]",
		);
	});

	test("formats multiple markers without changing other text", () => {
		expect(
			formatRenderedPasteMarkers("a [paste #1 +12 lines] b [paste #2 1200 chars] c"),
		).toBe("a [Pasted 12 lines] b [Pasted 1200 chars] c");
	});

	test("preserves ANSI styling around a marker", () => {
		const rendered = formatRenderedPasteMarkers("\x1b[7m[paste #1 +42 lines]\x1b[0m");
		expect(rendered).toBe("\x1b[7m[Pasted 42 lines]\x1b[0m");
	});

	test("leaves invalid and split marker text unchanged", () => {
		expect(formatRenderedPasteMarkers("[paste #1 +x lines]")).toBe("[paste #1 +x lines]");
		expect(formatRenderedPasteMarkers("[paste #1 +42\nlines]")).toBe(
			"[paste #1 +42\nlines]",
		);
	});

	test("never increases visible width", () => {
		const input = "\x1b[2m[paste #123 +420 lines]\x1b[0m tail";
		const output = formatRenderedPasteMarkers(input);
		expect(stripAnsi(output).length).toBeLessThanOrEqual(stripAnsi(input).length);
	});
});

type FakeEditorOptions = {
	compactText: string;
	expandedText: string;
	cursor?: { line: number; col: number };
	lines?: string[];
};

function fakeEditor(options: FakeEditorOptions) {
	let compactText = options.compactText;
	let expandedText = options.expandedText;
	const events: string[] = [];
	const expandedGetter = () => expandedText;
	const editor = {
		focused: true,
		onSubmit: undefined,
		onChange: undefined,
		disableSubmit: false,
		getText: () => compactText,
		getExpandedText: expandedGetter,
		getLines: () => options.lines ?? compactText.split("\n"),
		getCursor: () =>
			options.cursor ?? {
				line: compactText.split("\n").length - 1,
				col: compactText.split("\n").at(-1)?.length ?? 0,
			},
		setText: (text: string) => {
			events.push(`set:${text}`);
			compactText = text;
			expandedText = text;
		},
		handleInput: (data: string) => {
			events.push(`forward:${data}`);
		},
		render: () => ["[paste #1 +42 lines]"],
		invalidate: () => undefined,
	};
	return { editor, events, expandedGetter };
}

describe("Claude paste editor wrapper", () => {
	test("a repeated large paste expands once without leaving a new marker", () => {
		const pastedText = "x".repeat(1325);
		let compactText = "[paste #1 1325 chars]";
		let expandedText = pastedText;
		const editor = {
			getText: () => compactText,
			getExpandedText: () => expandedText,
			getLines: () => [compactText],
			getCursor: () => ({ line: 0, col: compactText.length }),
			setText: (text: string) => {
				compactText = text;
				expandedText = text;
			},
			handleInput: (data: string) => {
				if (data.includes("\x1b[201~")) {
					compactText += "[paste #2 1325 chars]";
					expandedText += pastedText;
				}
			},
			render: () => [compactText],
			invalidate: () => undefined,
		};
		wrapEditorForClaudePaste(editor as never);

		editor.handleInput(`\x1b[200~${pastedText}\x1b[201~`);

		expect(editor.getText()).toBe(pastedText);
		expect(editor.render().join("\n")).not.toContain("[Pasted 1325 chars]");
	});

	test("leaves a different second paste to Pi", () => {
		const { editor, events } = fakeEditor({
			compactText: "before [paste #1 +42 lines]",
			expandedText: "before full paste",
		});
		wrapEditorForClaudePaste(editor as never);

		editor.handleInput("\x1b[200~different\x1b[201~");

		expect(events).toEqual(["forward:\x1b[200~different\x1b[201~"]);
	});

	test("forwards without materializing at an unsafe cursor position", () => {
		const { editor, events } = fakeEditor({
			compactText: "before [paste #1 +42 lines]",
			expandedText: "before full paste",
			cursor: { line: 0, col: 3 },
		});
		wrapEditorForClaudePaste(editor as never);

		editor.handleInput("\x1b[200~second");

		expect(events).toEqual(["forward:\x1b[200~second"]);
	});

	test("keeps getExpandedText intact for outer editor wrappers", () => {
		const { editor, expandedGetter } = fakeEditor({
			compactText: "[paste #1 +42 lines]",
			expandedText: "full paste",
		});
		wrapEditorForClaudePaste(editor as never);

		expect(editor.getExpandedText).toBe(expandedGetter);
		expect(editor.getExpandedText()).toBe("full paste");
	});

	test("formats rendered labels and wraps an editor only once", () => {
		const { editor, events } = fakeEditor({ compactText: "", expandedText: "" });
		wrapEditorForClaudePaste(editor as never);
		wrapEditorForClaudePaste(editor as never);

		editor.handleInput("x");
		expect(events).toEqual(["forward:x"]);
		expect(editor.render()).toEqual(["[Pasted 42 lines]"]);
	});
});

type Handler = (event: unknown, ctx: unknown) => unknown;

class Harness {
	readonly handlers = new Map<string, Handler[]>();
	readonly pi = {
		on: (event: string, handler: Handler) => {
			this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
		},
	};

	constructor() {
		claudePaste(this.pi as never);
	}

	emitSync(event: string, ctx: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) handler({}, ctx);
	}
}

function lifecycleContext(
	harness: Harness,
	options: { invalidateOnModeRead?: boolean } = {},
) {
	let modeReads = 0;
	let editorReplacements = 0;
	let factory: unknown;
	const probe = {
		ctx: undefined as unknown,
		get modeReads() {
			return modeReads;
		},
		get editorReplacements() {
			return editorReplacements;
		},
	};

	probe.ctx = {
		get mode() {
			modeReads++;
			if (options.invalidateOnModeRead) {
				harness.emitSync("session_shutdown", probe.ctx);
				throw new Error(STALE_CONTEXT_ERROR);
			}
			return "tui";
		},
		hasUI: true,
		ui: {
			getEditorComponent: () => factory,
			setEditorComponent: (next: unknown) => {
				factory = next;
				editorReplacements++;
			},
		},
	};
	return probe;
}

describe("Claude paste extension lifecycle", () => {
	test("factory installation is idempotent", () => {
		let factory: unknown;
		let replacements = 0;
		const ctx = {
			mode: "tui",
			hasUI: true,
			ui: {
				getEditorComponent: () => factory,
				setEditorComponent: (next: unknown) => {
					factory = next;
					replacements++;
				},
			},
		};

		installClaudePasteEditorFactory(ctx as never);
		installClaudePasteEditorFactory(ctx as never);
		expect(replacements).toBe(1);
	});

	test("does not install a deferred factory after shutdown", async () => {
		const harness = new Harness();
		const stale = lifecycleContext(harness);
		harness.emitSync("session_start", stale.ctx);
		harness.emitSync("session_shutdown", stale.ctx);
		await Promise.resolve();

		expect(stale.modeReads).toBe(0);
		expect(stale.editorReplacements).toBe(0);
	});

	test("only the newest session generation installs", async () => {
		const harness = new Harness();
		const oldSession = lifecycleContext(harness);
		const newSession = lifecycleContext(harness);
		harness.emitSync("session_start", oldSession.ctx);
		harness.emitSync("session_start", newSession.ctx);
		await Promise.resolve();

		expect(oldSession.editorReplacements).toBe(0);
		expect(newSession.editorReplacements).toBe(1);
	});

	test("ignores a stale-context race during deferred install", async () => {
		const harness = new Harness();
		const raced = lifecycleContext(harness, { invalidateOnModeRead: true });
		harness.emitSync("session_start", raced.ctx);
		await Promise.resolve();

		expect(raced.modeReads).toBe(1);
		expect(raced.editorReplacements).toBe(0);
	});
});
