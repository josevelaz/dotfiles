/**
 * Pure helpers for force-queued-on-enter (no Pi runtime imports).
 * Kept separate so unit tests can run without Pi's jiti virtual modules.
 */

/** Pure decision helper — exported for deterministic tests. */
export type ForceQueuedDecision =
	| { action: "pass" }
	| { action: "ignore" }
	| { action: "force" };

export type ForceQueuedDecisionInput = {
	isSubmitKey: boolean;
	editorEmpty: boolean;
	isIdle: boolean;
	hasPendingMessages: boolean;
	inFlight: boolean;
	showingAutocomplete: boolean;
	disposed: boolean;
};

export function decideForceQueuedAction(input: ForceQueuedDecisionInput): ForceQueuedDecision {
	if (input.disposed) return { action: "pass" };
	if (!input.isSubmitKey) return { action: "pass" };
	if (input.inFlight) return { action: "ignore" };
	if (input.showingAutocomplete) return { action: "pass" };
	if (!input.editorEmpty) return { action: "pass" };
	if (input.isIdle) return { action: "pass" };
	if (!input.hasPendingMessages) return { action: "pass" };
	return { action: "force" };
}

export type IdleGate = {
	waitUntilIdle: (isIdle: () => boolean, isCancelled: () => boolean) => Promise<void>;
	notifySettled: () => void;
	dispose: () => void;
};

/** Deterministic idle wait that combines agent_settled notifications with isIdle polling. */
export function createIdleGate(options?: { pollMs?: number }): IdleGate {
	const pollMs = options?.pollMs ?? 25;
	const waiters = new Set<() => void>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let disposed = false;

	const checkWaiters = () => {
		for (const check of [...waiters]) check();
	};

	return {
		notifySettled() {
			if (disposed) return;
			checkWaiters();
		},
		dispose() {
			disposed = true;
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			checkWaiters();
		},
		waitUntilIdle(isIdle, isCancelled) {
			if (disposed || isCancelled() || isIdle()) return Promise.resolve();

			return new Promise<void>((resolve) => {
				let finished = false;

				const finish = () => {
					if (finished) return;
					finished = true;
					waiters.delete(check);
					resolve();
				};

				const check = () => {
					if (disposed || isCancelled() || isIdle()) finish();
				};

				const schedulePoll = () => {
					const timer = setTimeout(() => {
						timers.delete(timer);
						check();
						if (!finished) schedulePoll();
					}, pollMs);
					timers.add(timer);
				};

				waiters.add(check);
				schedulePoll();
			});
		},
	};
}

export type ForceQueuedFlowDeps = {
	abort: () => void;
	isIdle: () => boolean;
	isCancelled: () => boolean;
	getEditorText: () => string;
	setEditorText: (text: string) => void;
	submit: (text: string) => void | Promise<void>;
	waitUntilIdle: (isIdle: () => boolean, isCancelled: () => boolean) => Promise<void>;
	onError?: (error: unknown) => void;
};

/**
 * Abort → wait idle → submit restored editor text.
 * Exported for deterministic tests.
 */
export async function runForceQueuedFlow(deps: ForceQueuedFlowDeps): Promise<"submitted" | "aborted" | "empty"> {
	try {
		deps.abort();
		await deps.waitUntilIdle(deps.isIdle, deps.isCancelled);
		if (deps.isCancelled()) return "aborted";

		const text = deps.getEditorText().trim();
		if (!text) return "empty";

		deps.setEditorText("");
		await deps.submit(text);
		return "submitted";
	} catch (error) {
		deps.onError?.(error);
		return "aborted";
	}
}
