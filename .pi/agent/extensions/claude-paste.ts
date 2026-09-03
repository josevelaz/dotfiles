/**
 * Claude-style paste presentation for Pi's global TUI editor.
 *
 * Pi keeps ownership of paste buffering, full content, undo, deletion, and
 * submission. Repeating the text represented by a trailing marker resolves it
 * to one full copy. The wrapper also changes only the rendered marker label.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	createRepeatedPasteProbe,
	endsBracketedPaste,
	formatRenderedPasteMarkers,
	shouldExpandRepeatedPaste,
	startsBracketedPaste,
	type RepeatedPasteProbe,
} from "../lib/claude-paste/logic.ts";

export {
	createRepeatedPasteProbe,
	endsBracketedPaste,
	formatRenderedPasteMarkers,
	shouldExpandRepeatedPaste,
	startsBracketedPaste,
	type RepeatedPasteProbe,
} from "../lib/claude-paste/logic.ts";

const FACTORY_MARK = Symbol.for("pi.claudePaste.factory");
const EDITOR_MARK = Symbol.for("pi.claudePaste.editor");
const STALE_CONTEXT_MESSAGE = "This extension ctx is stale after session replacement or reload";

type SessionState = {
	disposed: boolean;
};

type EditorLike = EditorComponent & {
	getExpandedText?: () => string;
	getLines?: () => string[];
	getCursor?: () => { line: number; col: number };
	[EDITOR_MARK]?: true;
};

type EditorFactory = ((
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => EditorComponent) & {
	[FACTORY_MARK]?: true;
};

function isCursorAtDraftEnd(editor: EditorLike): boolean {
	const lines = editor.getLines?.();
	const cursor = editor.getCursor?.();
	if (!lines || !cursor || lines.length === 0) return false;

	const finalLine = lines.length - 1;
	return cursor.line === finalLine && cursor.col === (lines[finalLine]?.length ?? 0);
}

export function wrapEditorForClaudePaste(editor: EditorLike): EditorLike {
	if (editor[EDITOR_MARK]) return editor;

	const previousHandleInput = editor.handleInput.bind(editor);
	const previousRender = editor.render.bind(editor);
	let repeatedPasteProbe: RepeatedPasteProbe | undefined;

	editor.handleInput = (data: string) => {
		if (startsBracketedPaste(data) && editor.getExpandedText) {
			repeatedPasteProbe = createRepeatedPasteProbe(
				editor.getText(),
				editor.getExpandedText(),
				isCursorAtDraftEnd(editor),
			);
		}

		previousHandleInput(data);

		if (endsBracketedPaste(data) && repeatedPasteProbe && editor.getExpandedText) {
			const probe = repeatedPasteProbe;
			repeatedPasteProbe = undefined;
			if (shouldExpandRepeatedPaste(probe, editor.getExpandedText())) {
				editor.setText(probe.expandedText);
			}
		}
	};

	editor.render = (width: number) =>
		previousRender(width).map((line) => formatRenderedPasteMarkers(line));

	editor[EDITOR_MARK] = true;
	return editor;
}

export function installClaudePasteEditorFactory(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;

	const previousFactory = ctx.ui.getEditorComponent() as EditorFactory | undefined;
	if (previousFactory?.[FACTORY_MARK]) return;

	const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		const base = previousFactory
			? previousFactory(tui, theme, keybindings)
			: new CustomEditor(tui, theme, keybindings);
		return wrapEditorForClaudePaste(base as EditorLike);
	}) as EditorFactory;

	factory[FACTORY_MARK] = true;
	ctx.ui.setEditorComponent(factory);
}

function isStaleContextError(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith(STALE_CONTEXT_MESSAGE);
}

function installDeferredEditorFactory(
	ctx: ExtensionContext,
	state: SessionState,
	isCurrent: () => boolean,
): void {
	if (!isCurrent()) return;

	try {
		installClaudePasteEditorFactory(ctx);
	} catch (error) {
		if (isStaleContextError(error)) return;
		throw error;
	}
}

export default function (pi: ExtensionAPI) {
	let state: SessionState | undefined;
	let generation = 0;

	pi.on("resources_discover", (_event, ctx) => {
		if (!state || state.disposed) state = { disposed: false };
		installClaudePasteEditorFactory(ctx);
	});

	pi.on("session_start", (_event, ctx) => {
		const sessionGeneration = ++generation;
		const sessionState: SessionState = { disposed: false };
		state = sessionState;

		queueMicrotask(() => {
			installDeferredEditorFactory(
				ctx,
				sessionState,
				() =>
					generation === sessionGeneration &&
					state === sessionState &&
					!sessionState.disposed,
			);
		});
	});

	pi.on("session_shutdown", () => {
		generation++;
		if (state) state.disposed = true;
		state = undefined;
	});
}
