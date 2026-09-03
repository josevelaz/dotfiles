# Notes

Working notes for the AFK teaching workspace.

## Teaching preferences
- Short lessons. 5-8 minutes, one tangible win each.
- Practical over internal. The learner wants to operate the extension, not build one.
  Keep broker internals, socket framing, and event wiring as secondary detail only.
- Every claim gets a citation to a local source file or an official doc.
- Practice must be retrieval, not recognition. No multiple-choice buttons in exercises;
  the learner types the reply they would actually send.

## Design constraints for this workspace
- Offline-friendly: one shared external stylesheet (`assets/course.css`) and external JS
  widgets. No CDN, no external fonts, no inline CSS or JS.
- Visual identity: iMessage blue on quiet technical paper. The recurring motif is the
  "route tape" — phone -> session key -> Pi.
- Everything must print cleanly; the reference is meant to live next to the keyboard.

## Assets so far
- `assets/course.css` — shared stylesheet. Layout, route tape, callouts, practice widget
  skin, print rules.
- `assets/afk-route-practice.js` — reusable text-entry practice widget. Grades free-text
  replies with a deterministic engine that mirrors the real parsing rules in
  `protocol.ts` and `routing.mjs`. Scenario sets are declared inside the asset and
  selected from the lesson with `data-afk-practice="<set-id>"`. It exports its internals
  under `module.exports` when loaded outside a browser, which supports ad hoc Node
  checks.

## Correctness notes worth keeping
- **Triggers are subscriptions, not heuristics.** `index.ts` sends run-state alerts for
  the `afk:question` event, for `herdr:blocked` going active, for a `goal_report` tool
  result with status `blocked`, and on `agent_settled` when a run happened and the
  session is idle. These are the run-state alert subscriptions, not the only outbound
  texts: the extension also sends enable notices, invalid-answer corrections, and
  broker routing responses. Do not write "whenever Pi has a question".
- **A session key is not validated.** `routing.mjs` matches a leading token against the
  active sessions; an unknown or stale key simply falls through to the later rules. With
  exactly one active session the whole text, stale prefix included, is delivered to it —
  as a user message, or into the answer parser, which rejects it. A *current* key is the
  safest prefix. Never call a key "always safe".
- **Shutdown unregisters the session.** A closed session cannot be texted. The cost of
  leaving AFK on is unwanted texts and ambiguous routing, not messages into the void.

## State
- Mission captured. Resources captured.
- Lesson 0001 written: the handoff model and reply grammar.
- No learning record yet. The learner has not demonstrated mastery, so there is nothing
  to record. Write `learning-records/0001-*.md` after the first real AFK round trip.

## Open questions to ask the learner
- Has the Photon project been created and iMessage enabled yet?
- Are `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, and `PI_AFK_PHONE` already exported
  from the shell secret store?
- Do they routinely run more than one Pi session at once? That decides how much weight
  the session-key material deserves in lesson 0002.

## Candidate next lessons
- Running two AFK sessions on purpose and routing between them.
- Recovery drills: broker log, reconnecting state, stale lock.
- Subagent suppression: `--no-afk-texts` and `PI_AFK_DISABLE` in practice.
