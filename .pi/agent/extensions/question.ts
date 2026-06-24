/**
 * Question Tool - ask the user a single question with selectable options.
 *
 * Global pi extension loaded from ~/.pi/agent/extensions/question.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface OptionWithDesc {
	label: string;
	description?: string;
}

type DisplayOption = OptionWithDesc & { isOther?: boolean };

interface QuestionDetails {
	question: string;
	options: string[];
	answer: string | null;
	wasCustom?: boolean;
}

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below the label" })),
});

const QuestionParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
});

export default function question(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description: "Ask the user a question and let them pick from options. Use when you need user input to proceed.",
		promptSnippet: "Ask the user a multiple-choice question and optionally let them type a custom answer.",
		promptGuidelines: [
			"Use question when you need the user to choose between concrete options before proceeding.",
			"Do not use question for rhetorical questions or questions you can answer from available context.",
		],
		parameters: QuestionParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text" as const, text: "Error: UI not available in this pi mode." }],
					details: {
						question: params.question,
						options: params.options.map((option) => option.label),
						answer: null,
					} satisfies QuestionDetails,
				};
			}

			if (params.options.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Error: No options provided." }],
					details: { question: params.question, options: [], answer: null } satisfies QuestionDetails,
				};
			}

			const allOptions: DisplayOption[] = [...params.options, { label: "Type something.", isOther: true }];
			const result = await ctx.ui.custom<{ answer: string; wasCustom: boolean; index?: number } | null>(
				(tui, theme, _keybindings, done) => {
					let optionIndex = 0;
					let editMode = false;
					let cachedLines: string[] | undefined;

					const editorTheme: EditorTheme = {
						borderColor: (text) => theme.fg("accent", text),
						selectList: {
							selectedPrefix: (text) => theme.fg("accent", text),
							selectedText: (text) => theme.fg("accent", text),
							description: (text) => theme.fg("muted", text),
							scrollInfo: (text) => theme.fg("dim", text),
							noMatch: (text) => theme.fg("warning", text),
						},
					};
					const editor = new Editor(tui, editorTheme);

					editor.onSubmit = (value) => {
						const trimmed = value.trim();
						if (trimmed.length > 0) {
							done({ answer: trimmed, wasCustom: true });
							return;
						}

						editMode = false;
						editor.setText("");
						refresh();
					};

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					function handleInput(data: string) {
						if (editMode) {
							if (matchesKey(data, Key.escape)) {
								editMode = false;
								editor.setText("");
								refresh();
								return;
							}

							editor.handleInput(data);
							refresh();
							return;
						}

						if (matchesKey(data, Key.up)) {
							optionIndex = Math.max(0, optionIndex - 1);
							refresh();
							return;
						}

						if (matchesKey(data, Key.down)) {
							optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
							refresh();
							return;
						}

						if (matchesKey(data, Key.enter)) {
							const selected = allOptions[optionIndex];
							if (selected.isOther === true) {
								editMode = true;
								refresh();
								return;
							}

							done({ answer: selected.label, wasCustom: false, index: optionIndex + 1 });
							return;
						}

						if (matchesKey(data, Key.escape)) {
							done(null);
						}
					}

					function render(width: number): string[] {
						if (cachedLines !== undefined) return cachedLines;

						const lines: string[] = [];
						const add = (text: string) => lines.push(truncateToWidth(text, width));

						add(theme.fg("accent", "─".repeat(width)));
						add(theme.fg("text", ` ${params.question}`));
						lines.push("");

						for (let i = 0; i < allOptions.length; i += 1) {
							const option = allOptions[i];
							const selected = i === optionIndex;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const label = `${i + 1}. ${option.label}`;

							if (option.isOther === true && editMode) {
								add(prefix + theme.fg("accent", `${label} ✎`));
							} else if (selected) {
								add(prefix + theme.fg("accent", label));
							} else {
								add(`  ${theme.fg("text", label)}`);
							}

							if (option.description !== undefined) {
								add(`     ${theme.fg("muted", option.description)}`);
							}
						}

						if (editMode) {
							lines.push("");
							add(theme.fg("muted", " Your answer:"));
							for (const line of editor.render(width - 2)) {
								add(` ${line}`);
							}
						}

						lines.push("");
						if (editMode) {
							add(theme.fg("dim", " Enter to submit • Esc to go back"));
						} else {
							add(theme.fg("dim", " ↑↓ navigate • Enter to select • Esc to cancel"));
						}
						add(theme.fg("accent", "─".repeat(width)));

						cachedLines = lines;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				},
			);

			const simpleOptions = params.options.map((option) => option.label);

			if (result === null) {
				return {
					content: [{ type: "text" as const, text: "User cancelled the selection." }],
					details: { question: params.question, options: simpleOptions, answer: null } satisfies QuestionDetails,
				};
			}

			if (result.wasCustom) {
				return {
					content: [{ type: "text" as const, text: `User wrote: ${result.answer}` }],
					details: {
						question: params.question,
						options: simpleOptions,
						answer: result.answer,
						wasCustom: true,
					} satisfies QuestionDetails,
				};
			}

			return {
				content: [{ type: "text" as const, text: `User selected: ${result.index}. ${result.answer}` }],
				details: {
					question: params.question,
					options: simpleOptions,
					answer: result.answer,
					wasCustom: false,
				} satisfies QuestionDetails,
			};
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", args.question);
			const options = Array.isArray(args.options) ? args.options : [];
			if (options.length > 0) {
				const labels = options.map((option: OptionWithDesc) => option.label);
				const numbered = [...labels, "Type something."].map((option, index) => `${index + 1}. ${option}`);
				text += `\n${theme.fg("dim", `  Options: ${numbered.join(", ")}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionDetails | undefined;
			if (details === undefined) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.answer === null) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			if (details.wasCustom === true) {
				return new Text(
					theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", details.answer),
					0,
					0,
				);
			}

			const index = details.options.indexOf(details.answer) + 1;
			const display = index > 0 ? `${index}. ${details.answer}` : details.answer;
			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", display), 0, 0);
		},
	});
}
