/* ===========================================================================
   afk-route-practice.js — reusable retrieval-practice widget for the AFK course.

   Purpose
   -------
   The learner is shown a situation (which sessions are AFK, what Pi texted) and
   must TYPE the exact reply they would send from iMessage. There are no
   multiple-choice buttons: the point is to retrieve the syntax, not recognise it.

   Grading is deterministic. The widget does not string-match against an answer
   key. It re-implements the routing and parsing rules of the extension and then
   reports what the real system would have done with the typed reply:

     - routing        mirrors .pi/agent/extensions/afk/routing.mjs
     - answer parsing mirrors .pi/agent/extensions/afk/protocol.ts

   That includes the unhappy paths. An unknown or stale session key is NOT rejected
   as a key by routing.mjs: explicit matching simply falls through, so with exactly
   one active session the whole text — stale prefix included — is handed to that
   session as ordinary input, or parsed and rejected if a question is pending.

   Usage
   -----
     <div data-afk-practice="lesson-0001"></div>
     <script src="../assets/afk-route-practice.js" defer></script>

   Add a new scenario set to SCENARIO_SETS below and reference it by id from any
   lesson. Nothing in this file is lesson-specific except that table.
   =========================================================================== */

(function () {
	"use strict";

	/* ---------------------------------------------------------------------
	   Rules mirrored from the extension source.
	   --------------------------------------------------------------------- */

	// routing.mjs: explicitTarget()
	var EXPLICIT_RE = /^\s*\[?([a-z0-9]{4,16})\]?\s*(?::|-)?\s+([\s\S]+)$/i;

	// routing.mjs: chooseTarget() — "starts with a number"
	var LEADING_NUMBER_RE = /^\s*\d+(?:\s|$)/;

	// protocol.ts: parseRemoteQuestionAnswer()
	var ANSWER_RE = /^(\d+)(?:\s+([\s\S]+))?$/;

	/**
	 * protocol.ts: parseRemoteQuestionAnswer(input, options)
	 * @returns {{ok: true, result: object} | {ok: false, error: string}}
	 */
	function parseAnswer(input, options) {
		var trimmed = String(input).trim();
		var match = ANSWER_RE.exec(trimmed);
		var customIndex = options.length + 1;

		if (match === null) {
			return {
				ok: false,
				error:
					"Reply with 1-" +
					options.length +
					", or " +
					customIndex +
					" followed by your own answer.",
			};
		}

		var selected = Number(match[1]);
		var customText = match[2] ? match[2].trim() : undefined;

		if (selected >= 1 && selected <= options.length) {
			if (customText !== undefined) {
				return {
					ok: false,
					error: "Reply with only " + selected + " to select that option.",
				};
			}
			return {
				ok: true,
				result: { answer: options[selected - 1], index: selected, wasCustom: false },
			};
		}

		if (selected === customIndex) {
			if (!customText) {
				return {
					ok: false,
					error:
						"Add your answer after " +
						customIndex +
						", for example: " +
						customIndex +
						" my answer",
				};
			}
			return { ok: true, result: { answer: customText, wasCustom: true } };
		}

		return {
			ok: false,
			error:
				"Option " +
				selected +
				" is not valid. Reply with 1-" +
				options.length +
				", or " +
				customIndex +
				" followed by text.",
		};
	}

	/**
	 * routing.mjs: chooseTarget(input, active)
	 * @returns {{target: object, body: string} | {ambiguous: object[]}}
	 */
	function chooseTarget(input, sessions) {
		var explicit = EXPLICIT_RE.exec(input);
		if (explicit) {
			var key = explicit[1].toLowerCase();
			for (var i = 0; i < sessions.length; i += 1) {
				if (sessions[i].key.toLowerCase() === key) {
					return { target: sessions[i], body: explicit[2].trim() };
				}
			}
			// An unrecognised key is not a target; routing.mjs falls through.
		}

		var waiting = sessions.filter(function (session) {
			return session.state === "question";
		});
		if (LEADING_NUMBER_RE.test(input) && waiting.length === 1) {
			return { target: waiting[0], body: input.trim() };
		}
		if (sessions.length === 1) {
			return { target: sessions[0], body: input.trim() };
		}
		return { ambiguous: sessions };
	}

	/**
	 * Full simulation: what does the extension do with this reply?
	 * @returns {{kind: string, session?: object, ...}}
	 */
	function simulate(input, sessions) {
		var trimmed = String(input).trim();
		if (trimmed === "") return { kind: "empty" };

		// broker.mjs: no registered client means nothing can be routed.
		if (sessions.length === 0) return { kind: "no-session" };

		var chosen = chooseTarget(trimmed, sessions);
		if (!chosen.target) return { kind: "ambiguous", sessions: chosen.ambiguous };

		var target = chosen.target;
		var body = chosen.body;

		// index.ts handleInbound(): a pending question consumes the reply first.
		if (target.state === "question" && target.options) {
			var parsed = parseAnswer(body, target.options);
			if (!parsed.ok) return { kind: "rejected", session: target, error: parsed.error };
			if (parsed.result.wasCustom) {
				return { kind: "custom", session: target, text: parsed.result.answer };
			}
			return {
				kind: "choice",
				session: target,
				index: parsed.result.index,
				label: parsed.result.answer,
			};
		}

		// No pending question: the text becomes a user message.
		return {
			kind: "message",
			session: target,
			text: body,
			followUp: target.state === "working",
		};
	}

	/* ---------------------------------------------------------------------
	   Message rendering, mirroring formatQuestion()/formatNotice() in index.ts.
	   --------------------------------------------------------------------- */

	function formatQuestion(session) {
		var customIndex = session.options.length + 1;
		var choices = session.options
			.map(function (label, index) {
				return index + 1 + ". " + label;
			})
			.join("\n");
		return (
			"[" +
			session.key +
			"] " +
			session.label +
			"\nQuestion: " +
			session.question +
			"\n\n" +
			choices +
			"\n" +
			customIndex +
			". Type your own answer\n\nReply with a number, or " +
			customIndex +
			" followed by your answer. If several Pi sessions are AFK, prefix the reply with " +
			session.key +
			"."
		);
	}

	function formatNotice(session, body) {
		return (
			"[" +
			session.key +
			"] " +
			session.label +
			"\n" +
			body +
			"\n\nReply with a message to continue. If several Pi sessions are AFK, prefix it with " +
			session.key +
			"."
		);
	}

	function sessionText(session) {
		if (session.state === "question" && session.options) return formatQuestion(session);
		if (session.notice) return formatNotice(session, session.notice);
		return null;
	}

	/* ---------------------------------------------------------------------
	   Answer comparison.
	   --------------------------------------------------------------------- */

	function normalise(value) {
		return String(value)
			.toLowerCase()
			.replace(/\s+/g, " ")
			.replace(/[.!]+$/, "")
			.trim();
	}

	function sameSession(outcome, expect) {
		if (!expect.session) return true;
		return outcome.session && outcome.session.key === expect.session;
	}

	function isCorrect(outcome, expect) {
		if (outcome.kind !== expect.kind) return false;
		if (!sameSession(outcome, expect)) return false;
		if (expect.kind === "choice") return outcome.index === expect.index;
		if (expect.kind === "custom" || expect.kind === "message") {
			return normalise(outcome.text) === normalise(expect.text);
		}
		return false;
	}

	/* ---------------------------------------------------------------------
	   Feedback wording. Every branch describes what the real system did.
	   --------------------------------------------------------------------- */

	function describe(outcome) {
		switch (outcome.kind) {
			case "empty":
				return "You sent nothing. An empty text is never delivered.";
			case "no-session":
				return "No Pi session has `/afk` enabled, so the broker replies `No Pi session currently has /afk enabled.` and your reply goes nowhere.";
			case "ambiguous":
				return (
					"The broker could not tell which session you meant, so it texted back asking for a session key: " +
					outcome.sessions
						.map(function (session) {
							return "`" + session.key + "`";
						})
						.join(" and ") +
					". Nothing reached Pi."
				);
			case "rejected":
				return (
					"Session `" +
					outcome.session.key +
					"` rejected the reply and texted back: `" +
					outcome.error +
					"` The question is still waiting."
				);
			case "choice":
				return (
					"Session `" +
					outcome.session.key +
					"` answered its question with choice " +
					outcome.index +
					", `" +
					outcome.label +
					"`."
				);
			case "custom":
				return (
					"Session `" +
					outcome.session.key +
					"` answered its question with your own words: `" +
					outcome.text +
					"`."
				);
			case "message":
				return (
					"Session `" +
					outcome.session.key +
					"` received `" +
					outcome.text +
					"` as a user message" +
					(outcome.followUp ? ", queued as a follow-up because Pi was busy" : "") +
					"."
				);
			default:
				return "Nothing happened.";
		}
	}

	/* ---------------------------------------------------------------------
	   Scenario sets. Add new sets here; reference them by key from a lesson.
	   --------------------------------------------------------------------- */

	var REBASE_OPTIONS = [
		"Rebase onto main",
		"Merge main into the branch",
		"Stop and let me look",
	];

	var SCENARIO_SETS = {
		"lesson-0001": [
			{
				sessions: [
					{
						key: "019f94f1",
						label: "dotfiles",
						state: "question",
						question: "The branch has diverged from main. How should I proceed?",
						options: REBASE_OPTIONS,
					},
				],
				task: 'You want the second choice, "Merge main into the branch". Type the reply you would send.',
				expect: { kind: "choice", index: 2 },
				hint: "One session, one waiting question. Say the least you can say.",
				why: "A bare number picks a listed choice. Nothing else is needed, and nothing else is allowed.",
			},
			{
				sessions: [
					{
						key: "019f94f1",
						label: "dotfiles",
						state: "question",
						question: "The branch has diverged from main. How should I proceed?",
						options: REBASE_OPTIONS,
					},
				],
				task: 'Same question, but none of the three choices fit. Answer in your own words: use the safer approach',
				expect: { kind: "custom", text: "use the safer approach" },
				hint: "The custom slot is always one past the last listed choice.",
				why: "With three options the custom slot is 4. The number selects the slot; the text after it is your answer.",
			},
			{
				sessions: [
					{
						key: "019f94f1",
						label: "dotfiles",
						state: "question",
						question: "The branch has diverged from main. How should I proceed?",
						options: REBASE_OPTIONS,
					},
					{
						key: "a3c9d201",
						label: "weave",
						state: "question",
						question: "Two migrations conflict. Which one wins?",
						options: ["Keep the older migration", "Keep the newer migration", "Ask me later"],
					},
				],
				task: 'Two sessions are both waiting on a question. Choose option 2 in the dotfiles session, key 019f94f1.',
				expect: { kind: "choice", session: "019f94f1", index: 2 },
				hint: "A bare number is not enough when two sessions are waiting.",
				why: "The session key goes first, then a space, then the ordinary reply. Without the key the broker cannot tell the sessions apart.",
			},
			{
				sessions: [
					{ key: "019f94f1", label: "dotfiles", state: "idle", notice: "Pi is idle." },
					{
						key: "a3c9d201",
						label: "weave",
						state: "blocked",
						notice: "Blocked: the test suite needs a decision.",
					},
				],
				task: 'Two sessions are AFK and neither is asking a question. Tell the blocked weave session, key a3c9d201, to: run the tests again',
				expect: { kind: "message", session: "a3c9d201", text: "run the tests again" },
				hint: "The key prefix works for plain messages too, not only for answers.",
				why: "With no question pending, whatever follows the key becomes a user message and the run continues.",
			},
			{
				sessions: [
					{
						key: "019f94f1",
						label: "dotfiles",
						state: "question",
						question: "The branch has diverged from main. How should I proceed?",
						options: REBASE_OPTIONS,
					},
				],
				task: 'One session, one question. You want choice 1, "Rebase onto main". Type the reply that the parser accepts.',
				expect: { kind: "choice", index: 1 },
				hint: "Repeating the label back is a rejection, not a confirmation.",
				why: "Text after a listed number is rejected. Only the custom slot accepts a number followed by words.",
			},
			{
				sessions: [
					{
						key: "7b21e0a4",
						label: "dotfiles",
						state: "blocked",
						notice: "Blocked: the test suite needs a decision.",
					},
				],
				extra: [
					{
						term: "Older text still on your phone",
						detail:
							"[019f94f1] dotfiles\nPi is idle.\n\n(from yesterday's session, which has since been closed)",
					},
					{
						term: "Keys you can see",
						detail:
							"019f94f1 — scrolled up in the old text\n7b21e0a4 — the key listed above, and the one /afk status reports now",
					},
				],
				staleKey: "019f94f1",
				task: 'Two keys are visible on your phone and only one session is AFK now. Using the key that is currently listed, tell it: run the tests again',
				expect: { kind: "message", session: "7b21e0a4", text: "run the tests again" },
				hint: "Read the key off the newest text or off /afk status. Never retype one from memory.",
				why: "A current, recognised key is the safest prefix, and with one session so is no prefix at all. A stale key is not rejected as a key: `routing.mjs` finds no session with that key, explicit matching falls through, and because exactly one session is active the entire text — stale prefix and all — is delivered to it as an ordinary user message. Pi would have read `019f94f1 run the tests again` as your instruction.",
			},
			{
				sessions: [
					{
						key: "7b21e0a4",
						label: "dotfiles",
						state: "question",
						question: "The branch has diverged from main. How should I proceed?",
						options: REBASE_OPTIONS,
					},
				],
				extra: [
					{
						term: "Keys you can see",
						detail:
							"019f94f1 — from an older text, that session is gone\n7b21e0a4 — the key on the question above",
					},
				],
				staleKey: "019f94f1",
				task: 'Same two keys, but now a question is waiting. Choose option 2, "Merge main into the branch".',
				expect: { kind: "choice", session: "7b21e0a4", index: 2 },
				hint: "Either the current key or the bare number is safe here. A remembered key is not.",
				why: "With one session active, `2` and `7b21e0a4 2` both land. A stale key does not bounce as a bad key — it falls through to the single active session, and the parser then sees the whole string `019f94f1 2`, which does not start with a number. You get `Reply with 1-3, or 4 followed by your own answer.` back and the question is still waiting.",
			},
		],
	};

	/* ---------------------------------------------------------------------
	   Rendering helpers.
	   --------------------------------------------------------------------- */

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined && text !== null) node.textContent = text;
		return node;
	}

	/** Renders a string where `backticks` become <code> elements. */
	function richText(target, value) {
		var parts = String(value).split("`");
		for (var i = 0; i < parts.length; i += 1) {
			if (parts[i] === "") continue;
			if (i % 2 === 1) {
				target.appendChild(el("code", null, parts[i]));
			} else {
				target.appendChild(document.createTextNode(parts[i]));
			}
		}
		return target;
	}

	function describeSessions(sessions) {
		return sessions
			.map(function (session) {
				return session.key + " — " + session.label + " (" + session.state + ")";
			})
			.join("\n");
	}

	/* ---------------------------------------------------------------------
	   Widget.
	   --------------------------------------------------------------------- */

	function mount(root, scenarios, baseId) {
		var index = 0;
		var correct = 0;
		var answered = false;

		var titleId = baseId + "-title";
		var progressId = baseId + "-progress";
		var setupId = baseId + "-setup";
		var taskId = baseId + "-task";
		var inputId = baseId + "-input";
		var verdictId = baseId + "-verdict";
		var scoreId = baseId + "-score";

		root.classList.add("practice");
		root.textContent = "";
		root.setAttribute("role", "group");
		root.setAttribute("aria-labelledby", titleId);

		var head = el("div", "practice__head");
		var title = el("h3", "practice__title", "Route practice");
		title.id = titleId;
		var progress = el("p", "practice__progress");
		progress.id = progressId;
		head.appendChild(title);
		head.appendChild(progress);

		var setup = el("dl", "practice__setup");
		setup.id = setupId;
		var task = el("p", "practice__task");
		task.id = taskId;

		var form = el("form", "practice__form");
		form.setAttribute("novalidate", "novalidate");

		var field = el("div", "practice__field");
		var label = el("label", "practice__label", "Your iMessage reply");
		var input = el("input", "practice__input");
		input.id = inputId;
		input.type = "text";
		input.autocomplete = "off";
		input.spellcheck = false;
		input.placeholder = "type the text you would send";
		label.setAttribute("for", inputId);
		// The input carries the whole current context as its description, so moving
		// focus here after Next announces the new round, task, and setup exactly once.
		input.setAttribute("aria-describedby", progressId + " " + taskId + " " + setupId);
		field.appendChild(label);
		field.appendChild(input);

		var buttons = el("div", "practice__buttons");
		var send = el("button", "btn", "Send");
		send.type = "submit";
		var next = el("button", "btn btn--quiet", "Next");
		next.type = "button";
		next.disabled = true;
		buttons.appendChild(send);
		buttons.appendChild(next);

		form.appendChild(field);
		form.appendChild(buttons);

		// role="status" already implies aria-live="polite". Declaring both can make
		// some screen readers announce the verdict twice, so only the role is set.
		var verdict = el("div", "practice__verdict");
		verdict.id = verdictId;
		verdict.setAttribute("role", "status");
		verdict.setAttribute("aria-atomic", "true");

		var score = el("p", "practice__score");
		score.id = scoreId;

		root.appendChild(head);
		root.appendChild(setup);
		root.appendChild(task);
		root.appendChild(form);
		root.appendChild(verdict);
		root.appendChild(score);

		function addRow(term, detail) {
			setup.appendChild(el("dt", null, term));
			setup.appendChild(el("dd", null, detail));
		}

		function render() {
			var scenario = scenarios[index];
			answered = false;

			progress.textContent = "Round " + (index + 1) + " of " + scenarios.length;
			setup.textContent = "";
			addRow("Sessions with /afk on", describeSessions(scenario.sessions));

			scenario.sessions.forEach(function (session) {
				var body = sessionText(session);
				if (body) addRow("Text from " + session.label, body);
			});

			(scenario.extra || []).forEach(function (row) {
				addRow(row.term, row.detail);
			});

			task.textContent = scenario.task;
			verdict.textContent = "";
			verdict.className = "practice__verdict";
			input.value = "";
			input.disabled = false;
			send.disabled = false;
			next.disabled = true;
			next.textContent = index + 1 >= scenarios.length ? "Start over" : "Next";
			score.textContent =
				correct + " of " + scenarios.length + " correct so far. Hint: " + scenario.hint;
		}

		function grade() {
			if (answered) return;
			var scenario = scenarios[index];
			var outcome = simulate(input.value, scenario.sessions);
			var right = isCorrect(outcome, scenario.expect);
			answered = true;
			if (right) correct += 1;

			verdict.textContent = "";
			verdict.className =
				"practice__verdict practice__verdict--" + (right ? "right" : "wrong");
			verdict.appendChild(
				el("span", "practice__verdict-tag", right ? "Routed correctly" : "Not routed"),
			);
			verdict.appendChild(richText(el("p"), describe(outcome)));
			verdict.appendChild(
				richText(el("p"), right ? scenario.why : "Try again on the next pass. " + scenario.why),
			);

			input.disabled = true;
			send.disabled = true;
			next.disabled = false;
			next.focus();
			score.textContent = correct + " of " + scenarios.length + " correct so far.";
		}

		form.addEventListener("submit", function (event) {
			event.preventDefault();
			grade();
		});

		next.addEventListener("click", function () {
			index += 1;
			if (index >= scenarios.length) {
				index = 0;
				correct = 0;
			}
			render();
			input.focus();
		});

		render();
	}

	function init() {
		var roots = document.querySelectorAll("[data-afk-practice]");
		var seen = {};
		for (var i = 0; i < roots.length; i += 1) {
			var root = roots[i];
			var setId = root.getAttribute("data-afk-practice");
			var scenarios = SCENARIO_SETS[setId];
			if (!scenarios || scenarios.length === 0) {
				root.textContent = 'No practice scenarios are registered for "' + setId + '".';
				continue;
			}
			// Stable, deterministic ids: same markup always yields the same ids.
			seen[setId] = (seen[setId] || 0) + 1;
			var baseId = root.id || "afk-practice-" + setId + "-" + seen[setId];
			mount(root, scenarios, baseId);
		}
	}

	if (typeof document !== "undefined" && document !== null) {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", init);
		} else {
			init();
		}
	}

	// Test hook. Browsers never take this branch; the Node checks import it.
	if (typeof module === "object" && module !== null && module.exports) {
		module.exports = {
			chooseTarget: chooseTarget,
			describe: describe,
			isCorrect: isCorrect,
			mount: mount,
			parseAnswer: parseAnswer,
			SCENARIO_SETS: SCENARIO_SETS,
			simulate: simulate,
		};
	}
})();
