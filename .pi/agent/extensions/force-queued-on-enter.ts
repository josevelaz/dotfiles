/**
 * force-queued-on-enter
 *
 * When the agent is working, non-empty Enter keeps Pi's normal steering-queue
 * behavior. When the editor is empty, queued steering/follow-up messages exist,
 * and the user presses Enter, this extension:
 *   1. aborts the current run (Pi restores queued messages into the editor)
 *   2. waits until the session is idle
 *   3. submits the restored combined text as the next user prompt
 *
 * Global extension: ~/.pi/agent/extensions/force-queued-on-enter.ts
 * Pure helpers/tests: ~/.pi/agent/lib/force-queued-on-enter/
 *
 * Public APIs only (Pi 0.81.1): CustomEditor, setEditorComponent,
 * getEditorComponent, ctx.abort/hasPendingMessages/isIdle, agent_settled,
 * sendUserMessage, keybindings.matches("tui.input.submit").
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	createIdleGate,
	decideForceQueuedAction,
	runForceQueuedFlow,
	type IdleGate,
} from "../lib/force-queued-on-enter/logic.ts";

export {
	createIdleGate,
	decideForceQueuedAction,
	runForceQueuedFlow,
	type ForceQueuedDecision,
	type ForceQueuedDecisionInput,
	type ForceQueuedFlowDeps,
	type IdleGate,
} from "../lib/force-queued-on-enter/logic.ts";

const FACTORY_MARK = Symbol.for("pi.forceQueuedOnEnter.factory");
const STALE_CONTEXT_MESSAGE = "This extension ctx is stale after session replacement or reload";

type SessionState = {
	disposed: boolean;
	inFlight: boolean;
};

type EditorLike = EditorComponent & {
	isShowingAutocomplete?: () => boolean;
	getExpandedText?: () => string;
};

function isEditorEmpty(editor: EditorLike): boolean {
	const text = editor.getExpandedText?.() ?? editor.getText();
	return text.trim().length === 0;
}

function isShowingAutocomplete(editor: EditorLike): boolean {
	return typeof editor.isShowingAutocomplete === "function" && editor.isShowingAutocomplete();
}

function wrapEditor(
	editor: EditorLike,
	ctx: ExtensionContext,
	state: SessionState,
	keybindings: KeybindingsManager,
	idleGate: IdleGate,
	pi: ExtensionAPI,
): EditorLike {
	const previousHandleInput = editor.handleInput.bind(editor);

	editor.handleInput = (data: string) => {
		const decision = decideForceQueuedAction({
			isSubmitKey: keybindings.matches(data, "tui.input.submit"),
			editorEmpty: isEditorEmpty(editor),
			isIdle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
			inFlight: state.inFlight,
			showingAutocomplete: isShowingAutocomplete(editor),
			disposed: state.disposed,
		});

		if (decision.action === "pass") {
			previousHandleInput(data);
			return;
		}

		if (decision.action === "ignore") {
			return;
		}

		// action === "force"
		state.inFlight = true;
		void runForceQueuedFlow({
			abort: () => ctx.abort(),
			isIdle: () => ctx.isIdle(),
			isCancelled: () => state.disposed,
			getEditorText: () => editor.getExpandedText?.() ?? editor.getText(),
			setEditorText: (text) => {
				editor.setText(text);
				// Keep UI helper in sync when available.
				ctx.ui.setEditorText(text);
			},
			submit: async (text) => {
				if (editor.onSubmit) {
					await editor.onSubmit(text);
					return;
				}
				pi.sendUserMessage(text);
			},
			waitUntilIdle: idleGate.waitUntilIdle,
			onError: (error) => {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`force-queued-on-enter: ${message}`, "error");
			},
		}).finally(() => {
			state.inFlight = false;
		});
	};

	return editor;
}

function installEditorFactory(
	ctx: ExtensionContext,
	state: SessionState,
	idleGate: IdleGate,
	pi: ExtensionAPI,
): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;

	const previousFactory = ctx.ui.getEditorComponent() as
		| (((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) & {
				[FACTORY_MARK]?: true;
		  })
		| undefined;

	// Already our factory for this session — avoid double-wrapping.
	if (previousFactory?.[FACTORY_MARK]) return;

	const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		const base = previousFactory
			? previousFactory(tui, theme, keybindings)
			: new CustomEditor(tui, theme, keybindings);

		return wrapEditor(base as EditorLike, ctx, state, keybindings, idleGate, pi);
	}) as ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) & {
		[FACTORY_MARK]?: true;
	};

	factory[FACTORY_MARK] = true;
	ctx.ui.setEditorComponent(factory);
}

function isStaleContextError(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith(STALE_CONTEXT_MESSAGE);
}

function installDeferredEditorFactory(
	ctx: ExtensionContext,
	state: SessionState,
	idleGate: IdleGate,
	pi: ExtensionAPI,
	isCurrent: () => boolean,
): void {
	// The check must happen before the first ctx access. A context can also be
	// invalidated by that first access, so only the runner's known stale-context
	// error is ignored below; unrelated install failures still escape.
	if (!isCurrent()) return;

	try {
		installEditorFactory(ctx, state, idleGate, pi);
	} catch (error) {
		if (isStaleContextError(error)) return;
		throw error;
	}
}

export default function (pi: ExtensionAPI) {
	// Session-scoped state lives on the extension instance closure — not module globals.
	let state: SessionState | undefined;
	let generation = 0;
	let idleGate = createIdleGate();

	pi.on("agent_settled", () => {
		idleGate.notifySettled();
	});

	// Install after other extensions' session_start handlers (e.g. pi-vim) so we
	// can compositionally wrap whatever editor factory is currently active.
	pi.on("resources_discover", (_event, ctx) => {
		if (!state || state.disposed) {
			state = { disposed: false, inFlight: false };
		}
		installEditorFactory(ctx, state, idleGate, pi);
	});

	// Also schedule from session_start (deferred) so we still install if
	// resources_discover is skipped. Microtask runs after other session_start
	// handlers in the same turn, preserving editors they install first.
	pi.on("session_start", (_event, ctx) => {
		const sessionGeneration = ++generation;
		const sessionState: SessionState = { disposed: false, inFlight: false };
		state = sessionState;
		// Defer so later session_start handlers (same tick) can install first.
		queueMicrotask(() => {
			installDeferredEditorFactory(
				ctx,
				sessionState,
				idleGate,
				pi,
				() =>
					generation === sessionGeneration &&
					state === sessionState &&
					!sessionState.disposed,
			);
		});
	});

	pi.on("session_shutdown", () => {
		generation++;
		if (state) {
			state.disposed = true;
			state.inFlight = false;
		}
		state = undefined;
		idleGate.dispose();
		// Fresh gate if this instance is ever reused without a full reload.
		idleGate = createIdleGate();
	});
}
