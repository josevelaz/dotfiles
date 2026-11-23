/**
 * Deterministic unit tests for force-queued-on-enter helpers.
 * Run: bun test ~/.pi/agent/lib/force-queued-on-enter/logic.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
	createIdleGate,
	decideForceQueuedAction,
	runForceQueuedFlow,
	type ForceQueuedDecisionInput,
} from "./logic.ts";

function base(overrides: Partial<ForceQueuedDecisionInput> = {}): ForceQueuedDecisionInput {
	return {
		isSubmitKey: true,
		editorEmpty: true,
		isIdle: false,
		hasPendingMessages: true,
		inFlight: false,
		showingAutocomplete: false,
		disposed: false,
		...overrides,
	};
}

describe("decideForceQueuedAction", () => {
	test("forces abort+submit only for empty Enter with pending work", () => {
		expect(decideForceQueuedAction(base())).toEqual({ action: "force" });
	});

	test("passes through non-submit keys", () => {
		expect(decideForceQueuedAction(base({ isSubmitKey: false }))).toEqual({ action: "pass" });
	});

	test("passes through non-empty editor (normal steering)", () => {
		expect(decideForceQueuedAction(base({ editorEmpty: false }))).toEqual({ action: "pass" });
	});

	test("passes through when idle", () => {
		expect(decideForceQueuedAction(base({ isIdle: true }))).toEqual({ action: "pass" });
	});

	test("passes through when no pending messages", () => {
		expect(decideForceQueuedAction(base({ hasPendingMessages: false }))).toEqual({ action: "pass" });
	});

	test("ignores double Enter while in flight", () => {
		expect(decideForceQueuedAction(base({ inFlight: true }))).toEqual({ action: "ignore" });
	});

	test("passes through autocomplete confirm", () => {
		expect(decideForceQueuedAction(base({ showingAutocomplete: true }))).toEqual({ action: "pass" });
	});

	test("passes through when disposed", () => {
		expect(decideForceQueuedAction(base({ disposed: true }))).toEqual({ action: "pass" });
	});
});

describe("createIdleGate", () => {
	test("resolves immediately when already idle", async () => {
		const gate = createIdleGate({ pollMs: 5 });
		await gate.waitUntilIdle(() => true, () => false);
		gate.dispose();
	});

	test("resolves on notifySettled once the session is idle", async () => {
		const gate = createIdleGate({ pollMs: 5 });
		let idle = false;
		const wait = gate.waitUntilIdle(() => idle, () => false);
		idle = true;
		gate.notifySettled();
		await wait;
		gate.dispose();
	});

	test("does not resolve a settled notification while another run is active", async () => {
		const gate = createIdleGate({ pollMs: 5 });
		let idle = false;
		let resolved = false;
		const wait = gate.waitUntilIdle(() => idle, () => false).then(() => {
			resolved = true;
		});

		gate.notifySettled();
		await Bun.sleep(10);
		expect(resolved).toBe(false);

		idle = true;
		gate.notifySettled();
		await wait;
		expect(resolved).toBe(true);
		gate.dispose();
	});

	test("resolves via poll when isIdle becomes true without settled", async () => {
		const gate = createIdleGate({ pollMs: 5 });
		let idle = false;
		const wait = gate.waitUntilIdle(() => idle, () => false);
		setTimeout(() => {
			idle = true;
		}, 15);
		await wait;
		gate.dispose();
	});

	test("resolves when cancelled", async () => {
		const gate = createIdleGate({ pollMs: 5 });
		let cancelled = false;
		const wait = gate.waitUntilIdle(() => false, () => cancelled);
		cancelled = true;
		gate.notifySettled();
		await wait;
		gate.dispose();
	});
});

describe("runForceQueuedFlow", () => {
	test("aborts, waits for idle, then submits restored text", async () => {
		const calls: string[] = [];
		let idle = false;
		let editorText = "";

		const result = await runForceQueuedFlow({
			abort: () => {
				calls.push("abort");
				editorText = "steering one\n\nfollow-up two";
			},
			isIdle: () => idle,
			isCancelled: () => false,
			getEditorText: () => editorText,
			setEditorText: (text) => {
				editorText = text;
				calls.push(`set:${text}`);
			},
			submit: (text) => {
				calls.push(`submit:${text}`);
			},
			waitUntilIdle: async (isIdle) => {
				calls.push("wait");
				// Simulate agent finishing after abort.
				idle = true;
				expect(isIdle()).toBe(true);
			},
		});

		expect(result).toBe("submitted");
		expect(calls).toEqual([
			"abort",
			"wait",
			"set:",
			"submit:steering one\n\nfollow-up two",
		]);
		expect(editorText).toBe("");
	});

	test("returns empty when restore produced no text", async () => {
		const result = await runForceQueuedFlow({
			abort: () => {},
			isIdle: () => true,
			isCancelled: () => false,
			getEditorText: () => "   ",
			setEditorText: () => {},
			submit: () => {
				throw new Error("should not submit");
			},
			waitUntilIdle: async () => {},
		});
		expect(result).toBe("empty");
	});

	test("returns aborted when cancelled during wait", async () => {
		let cancelled = false;
		const result = await runForceQueuedFlow({
			abort: () => {
				cancelled = true;
			},
			isIdle: () => false,
			isCancelled: () => cancelled,
			getEditorText: () => "nope",
			setEditorText: () => {},
			submit: () => {
				throw new Error("should not submit");
			},
			waitUntilIdle: async (_isIdle, isCancelled) => {
				expect(isCancelled()).toBe(true);
			},
		});
		expect(result).toBe("aborted");
	});

	test("double-flight guard: second decide is ignore while inFlight", () => {
		const first = decideForceQueuedAction(base({ inFlight: false }));
		const second = decideForceQueuedAction(base({ inFlight: true }));
		expect(first).toEqual({ action: "force" });
		expect(second).toEqual({ action: "ignore" });
	});
});

describe("editor wrap harness (no Pi runtime)", () => {
	test("empty Enter with pending aborts and submits; non-empty passes through", async () => {
		const {
			createIdleGate: makeGate,
			decideForceQueuedAction: decide,
			runForceQueuedFlow: runFlow,
		} = await import("./logic.ts");

		const previousHandleInputs: string[] = [];
		const submitted: string[] = [];
		let editorText = "";
		let idle = false;
		let pending = true;
		let aborted = false;
		let inFlight = false;
		const disposed = false;
		const idleGate = makeGate({ pollMs: 5 });

		const editor = {
			getText: () => editorText,
			setText: (text: string) => {
				editorText = text;
			},
			handleInput(data: string) {
				previousHandleInputs.push(data);
			},
			onSubmit: (text: string) => {
				submitted.push(text);
			},
		};

		const keybindings = {
			matches: (data: string, id: string) => data === "\r" && id === "tui.input.submit",
		};

		const original = editor.handleInput.bind(editor);
		editor.handleInput = (data: string) => {
			const decision = decide({
				isSubmitKey: keybindings.matches(data, "tui.input.submit"),
				editorEmpty: editor.getText().trim().length === 0,
				isIdle: idle,
				hasPendingMessages: pending,
				inFlight,
				showingAutocomplete: false,
				disposed,
			});

			if (decision.action === "pass") {
				original(data);
				return;
			}
			if (decision.action === "ignore") return;

			inFlight = true;
			void runFlow({
				abort: () => {
					aborted = true;
					pending = false;
					editorText = "restored A\n\nrestored B";
					queueMicrotask(() => {
						idle = true;
						idleGate.notifySettled();
					});
				},
				isIdle: () => idle,
				isCancelled: () => disposed,
				getEditorText: () => editor.getText(),
				setEditorText: (text) => editor.setText(text),
				submit: async (text) => editor.onSubmit(text),
				waitUntilIdle: idleGate.waitUntilIdle,
			}).finally(() => {
				inFlight = false;
			});
		};

		// Non-empty Enter → pass through (steering remains Pi's job)
		editorText = "steer me";
		editor.handleInput("\r");
		expect(previousHandleInputs).toEqual(["\r"]);
		expect(aborted).toBe(false);

		// Empty Enter + pending → force path
		previousHandleInputs.length = 0;
		editorText = "";
		idle = false;
		pending = true;
		editor.handleInput("\r");
		expect(previousHandleInputs).toEqual([]);
		expect(aborted).toBe(true);

		// Second Enter while in flight is ignored
		editor.handleInput("\r");
		expect(previousHandleInputs).toEqual([]);

		await Bun.sleep(40);
		expect(submitted).toEqual(["restored A\n\nrestored B"]);
		expect(editorText).toBe("");
		expect(inFlight).toBe(false);

		idleGate.dispose();
	});
});
