# OpenCode goal continuity audit

Date: 2026-09-14. Status: investigation complete with integration limits noted;
no runtime changes.

## Required behavior

User requirement: **“I should only be able to stop a goal by saying /goal stop.”**

- `/goal stop` is the only explicit cancellation command for an unfinished goal.
- Stopping one model response, pressing Escape, disconnecting a client, or
  restarting the service must not cancel the goal.
- Inactivity eviction, provider failures, a no-tool response, and continuation
  limits must not silently abandon an unfinished goal.
- Keep the goal enabled while it waits for a recoverable dependency. Resume when
  that dependency becomes available. Show what it is waiting for.
- Waiting is not permission to bypass an approval, denied operation, missing
  credential, provider limit, or unavailable service. Reconnect the control
  channel at a bounded rate for the runtime's lifetime. Retry execution only
  when the outcome is known and repetition is safe; otherwise retain a visible
  wait until reconciliation or an external event makes progress safe. Never
  repeat a non-idempotent operation merely because its response was lost.
- Verified completion is distinct from cancellation. This audit assumes that a
  goal can still finish when its completion condition is satisfied.
- The requirement does not make execution possible while the host is asleep or
  the service is down. Recovery must occur when the runtime is available again.

## Confirmed overnight incident

Session: `ses_f6190490fffeUEgF9IkIFb0QxF`, “Drifty Reimagined Unreal C++
Vertical Slice.” OpenCode version: **2.0.3**. All times below are EDT on
2026-09-14.

| Time | Evidence |
| --- | --- |
| 01:42:41 | Goal snapshot records an active goal. |
| 01:58:22 | A `grep` call on Unreal's `AutomationTest.h` begins and remains pending. |
| 02:59:00 | The tool and assistant step receive aborted/interrupted errors. The session records an interrupted outcome. |
| 02:59:00.523 | The server logs `location services evicted` for the Drifty directory. |
| 02:59:08 | Eight synthetic snapshots record a paused goal with the reason `Interrupted by the user.` |
| 02:59:25 | The assistant says it is paused and will make no further changes. |
| 07:07:39 | A later snapshot records the goal as resumed. |

The user was asleep and did not press Stop. The goal snapshot records about
76 minutes of active time, while the user recalled 73 minutes. Neither number is
a configured goal timeout. The relevant interval is about 60 minutes with the
tool still pending. The continuation count was zero, so the goal did not exhaust
its continuation budget.

### Failure sequence

1. OpenCode's location activity service uses a default **60-minute** expiry and a
   one-minute sweep. Only durable session events refresh its activity record.
2. On expiry, core explicitly interrupts running executions with
   `reason: "inactivity"`, waits for cleanup, and unloads the location services.
3. The goal extension pauses on every interruption except `superseded`.
4. Its reason formatter recognizes `shutdown` but labels every other reason
   `Interrupted by the user.` This mislabels inactivity.
5. Auto-continuation runs after execution success, not after this interruption.

Sources:

- [OpenCode 2.0.3 location activity service, lines 25–81](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/location-activity.ts#L25-L81).
- [Core eviction test, lines 176–197](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/test/location-activity.test.ts#L176-L197).
- Local [goal event handler](../.config/opencode/plugins/goal/index.ts), lines
  521–530, 576–605, and 681–683.
- Local server log: `~/.local/share/opencode/log/opencode.log`, lines
  125513–125532 at audit time, run `b85213b3`.
- Session API messages: `msg_09e7e6501001W9pJ5ENK3998mf` (pending tool and
  interruption), `msg_09eb64527001RGF018KiUqfJIS` (interrupted outcome), and
  `msg_09eb65e82001ZwdIf1lpaKAchM` (first paused snapshot).

The available history does not establish why `grep` remained pending. Do not
describe the wait as an Unreal build timeout: the background build finished in
2.57 seconds with a reflected-name compilation error. Its notification was
delivered after the interruption.

## Investigation scope and baseline

Audit the current working copy, including changes that existed before this
investigation. Do not overwrite those changes. Dotfiles HEAD at audit start:
`e645f72e2ebc9ee937f52eb79a5a7aa81a26236d`.

Areas under review: command semantics, failure recovery, event subscriptions,
multiple loaded locations, restart and reload recovery, persistence, compaction,
queued input, background work, and stop/completion races.

Baseline command, run from `.config/opencode/plugins/goal`:

```sh
bun test ./controller.test.ts ./index.test.ts ./state.test.ts
```

Result: **36 passed, 0 failed, 118 assertions**. These tests describe the current
contract, including automatic pauses. Passing them does not prove the new
`/goal stop`-only contract.

## Findings beyond the incident

Evidence labels:

- **Observed:** present in the overnight session or server log.
- **Source-confirmed:** follows directly from the inspected implementation.
- **Probe-confirmed:** exercised the real `GoalRuntime` with in-memory API
  substitutes, without making live API calls.
- **Conditional:** requires a runtime condition that has not been reproduced.

### F1. Alternate cancellation paths and non-canceling stalls

**High; source-confirmed and covered by existing tests.**

Destructive control paths:

- `clear`, `off`, `reset`, `none`, and `cancel` clear the goal, just like `stop`.
- A new `/goal <text>` replaces the current objective immediately.

Non-canceling paths that retain the objective but stop automatic work:

- `/goal pause` disables automatic continuation.
- Any execution failure pauses the goal. Recoverable provider errors can reach
  this path after core's own recovery has stopped.
- Every interruption except `superseded` pauses the goal, including response
  cancellation, shutdown, and the observed inactivity interruption.
- A continuation without a tool call pauses the goal.
- The default limit of 100 continuations changes the goal to `budget-limited`.
  `/goal resume` retains the exhausted count but submits one extra continuation
  without checking the budget. After a successful substantive turn, automatic
  chaining stops at the same budget again.
- `goal_report` with `blocked` disables continuation until a manual resume.

Required direction: keep unfinished goal intent enabled. Distinguish execution
state (`running`, `waiting`, `retrying`) from goal state. A real blocker may
require user help, but it must not become an unreported cancellation. Whether an
explicit pause command remains available is a separate product decision; pause is
not cancellation, but the current paused states are operationally inert. Reject attempts
to replace an active objective unless the replacement policy is explicit; do
not turn an invalid control word into a new goal by accident.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 24,
395–445, 465–469, 524–530, 595–627;
[controller.ts](../.config/opencode/plugins/goal/controller.ts), lines 14,
77–83, 129–134; existing `index.test.ts`, lines 198–223 and 336–430.

### F2. Stop uses an absent inbox API and issues no interruption request

**High; source-confirmed at the plugin boundary and probe-confirmed.**

The handler clears the controller and attempts to cancel only its remembered
pending continuation. It never calls the session interruption API. It also
does not retain the ID of the initial prompt it submits.

More importantly, OpenCode 2.0.3's actual Promise plugin context exposes
`session.interrupt`, but **does not expose `session.inbox`**. The plugin's local
interface invents an optional `session.inbox.cancel` capability. Optional
chaining silently skips cancellation when it is absent. Its existing test
harness supplies that missing API, so the passing cancellation test does not
match the shipped runtime.

The isolated probe emitted `session.execution.started`, then invoked the plugin
command directly. The persisted goal became `null`; the session interruption
API was called **zero** times. This is a plugin-call observation, not a live
tool cancellation test. The inspected core command dispatch calls the command
handler without an explicit interruption. The TUI's full input path was not
exercised.

Required direction: persist explicit cancellation intent, cancel autonomous
queued work, interrupt owned execution, and confirm settlement. Preserve
unrelated user prompts. Show a cleanup failure rather than claiming everything
has stopped. Late events must not reactivate a canceled goal.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 55–77,
372–402, 439–444; existing `index.test.ts`, lines 109–113, 432–442;
[actual Promise session adapter, session lines 569–587](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/plugin/src/promise/adapter.ts#L569-L587),
[core command dispatch, session lines 409–414](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session.ts#L409-L414),
and [command execution](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/command.ts#L11-L35).
The mock included an `interrupt` method so an attempted call would have been
recorded.

### F3. One event-stream or handler error silently disables future recovery

**High; source-confirmed and probe-confirmed.**

`listen()` has one outer `try/catch`. A disconnected stream or any exception
from `handleEvent()` exits the listener. It logs no error, reconnects to no
stream, and schedules no reconciliation. A normal stream end also ends it.
Events are awaited serially, so one stalled handler delays every later event
seen by that plugin instance.

An event handler can throw because a session read, synthetic persistence, inbox
cancellation, or continuation submission fails. This can affect a goal that
was not responsible for the failure.

Two isolated probes supplied a stream failure and a synthetic-write failure
during success handling. Both left a persisted **active** goal with only its
initial prompt and one subscription attempt. No continuation was submitted.

Required direction: isolate handler failures, report them, reconnect with
backoff, and reconcile durable state after a gap. A healthy-looking active
label must not hide a dead scheduler.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 230–263,
355–365, 576–632.

### F4. Success is marked handled before continuation is safely scheduled

**High; source-confirmed and probe-confirmed for a persistence failure.**

`handledSuccess` becomes true before state loading, token accounting,
persistence, or prompt submission succeeds. If one of those operations fails,
a replayed success event is ignored. The probe retried the same success after
the injected persistence outage ended; it still submitted no continuation.

There is also a crash window between writing the progress snapshot and
submitting the continuation. A durable active goal is not evidence that work
was durably queued. The inverse window exists after core admits the prompt but
before the plugin records its ID in memory.

Required direction: make recovery idempotent and reconcile the durable inbox
before retrying admission. Do not mark scheduling complete before it succeeds.
Do not blindly enqueue a duplicate when the admission result is uncertain.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 576–589,
629–651.

### F5. Restoring a goal record is not the same as resuming work

**Source-confirmed gap; end-to-end restart outcome depends on core.**

Startup registers hooks and starts the listener. It does not enumerate active
goals or reconcile them with the active session list and durable inbox. The
restore path rebuilds a controller only when an event, context hook, or command
asks for it. Cleanup discards pending continuation IDs and remembered user inbox
IDs. Core may independently recover admitted work; this plugin adds no recovery
for a goal that is active but has no admitted work left.

Existing restart tests invoke the context hook, `check`, or `resume` after the
new runtime starts. They prove restoration on demand, not unattended recovery.

Core does recover interrupted in-flight turns after a crash or shutdown by
using a durable execution claim. Shutdown keeps that claim; inactivity and
user interruption release it. Recovery is at-least-once, not a guarantee that
external side effects happen only once.

Required direction: reconcile enabled goals on startup, reload, reconnect, and
execution settlement. Account for core recovery rather than competing with it.
Reconstruct queued work from durable state; do not rely on process-local sets.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 165–238,
284–334, 534–574; existing `index.test.ts`, lines 492–596;
[core execution claims, execution lines 79–146](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/execution.ts#L79-L146)
and [restart recovery](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/execution/restart.ts#L35-L61).

### F6. Clearing a queued-input gate does not trigger continuation

**Source-confirmed; probe-confirmed for the supplied event sequence.**

If success arrives while user input is queued, the plugin suppresses its
continuation. If that queued input is then canceled, the cancellation handler
only removes its ID; it does not reconsider whether the goal needs work.

The isolated sequence was: start goal → enqueue user input → execution succeeds
→ cancel the user input. The goal remained `active`, with no prompt beyond the
initial one. `/goal resume` replied: `No paused, blocked, or budget-limited goal
to resume.` Reachability of this ordering depends on core inbox admission and
delivery; do not claim it happens after every canceled message.

Required direction: reconcile when an inbox item is delivered or canceled,
while respecting user-input priority and existing active execution.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 415–422,
534–555, 612–614. The existing queued-input test stops before gate removal
(`index.test.ts`, lines 367–380).

### F7. Failed stop cleanup leaves memory and durable state in conflict

**High; source-confirmed and probe-confirmed.**

The handler clears the controller before canceling queued work. If an inbox
cancellation capability is supplied, cancellation clears the remembered ID
before awaiting the API. If that API rejects, the
cleared snapshot is never persisted. Memory says there is no goal, while the
latest durable snapshot still says active. A repeated `/goal stop` reports that
there is no goal and does not retry cancellation.

The probe observed exactly that sequence: one failed cancellation call,
persisted status `active`, and subsequent status/stop commands reporting no
goal. Similar ordering applies to achieved and blocked reports. In the shipped
2.0.3 plugin context this optional capability is absent (F2); this failure path
matters for adapters that provide it and for a future cancellation fix.

Required direction: make the cancellation record durable independently of
cleanup. Retain cleanup work until settled. Repeated stop must be safe and retry
unfinished cleanup. Recovery must honor the stop record before scheduling work.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 372–402,
458–469.

### F8. Reports and execution events are not tied to a goal generation

**High; source-confirmed and probe-confirmed for report handling.**

An existing response can outlive the goal it started with. Starting another
goal overwrites the controller. A later report carries only a session ID and
applies to whichever goal is current. In the isolated probe, a report with
evidence for goal A marked replacement goal B as achieved.

Execution bookkeeping likewise uses session-level booleans, not a goal
generation. Old completion or failure events can affect the replacement goal.
This is especially important if a stopped goal is followed by a new goal while
old work is still settling.

Required direction: bind reports and autonomous work to a durable goal
identity/generation. Reject stale reports and prevent old work from advancing,
pausing, or finishing a newer goal. Settling old work before starting new work
is also required; a generation check alone does not cancel side effects.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 43–45,
127–134, 197–199, 430–438, 447–472, 501–531.

### F9. Persistence fallback can restore stale state

**Conditional, with a source-confirmed failure path.**

The transcript snapshot is written first. Plugin storage is a best-effort
second copy; read and write errors are suppressed. If the transcript context
has no snapshot, restore uses storage without comparing a durable revision.
An old storage value can therefore restore a paused goal, restore no goal, or
resurrect an explicitly stopped goal if the newer transcript marker is absent.

The code itself documents the stopped-goal resurrection risk. This audit has
not shown that normal compaction removes these particular synthetic messages;
the condition may instead require truncation, a history operation, or another
failure. Existing compaction tests simulate absence rather than running core
compaction.

Required direction: choose an authoritative durable goal record with ordered
revisions and a durable stop marker. Treat transcript text as presentation or
as a recoverable copy, not as an unversioned competitor. Surface persistence
failures and retry them safely.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 298–365;
[state.ts](../.config/opencode/plugins/goal/state.ts), lines 117–130;
existing `index.test.ts`, lines 514–541 and 582–596.

### F10. Completion depends on the model's evidence claim

**Source-confirmed trust boundary, not proof of a false completion overnight.**

An `achieved` report with any nonempty evidence string completes the current
goal. The extension checks neither the truth of that evidence nor individual
acceptance criteria. The tool description asks the model to audit completion;
the runtime does not independently verify it.

Required direction: preserve the distinction between cancellation and actual
completion. Bind evidence to the current goal, require the completion audit,
and expose the evidence. Decide whether high-impact goals need a separate
verification gate. A success-shaped report is not proof that the goal is done.

Evidence: [index.ts](../.config/opencode/plugins/goal/index.ts), lines 27–28,
180–195, 447–462.

There is also an unresolved completed-goal policy: `/goal stop` currently clears
an already achieved goal and its current evidence, since `clear()` accepts any
state. It does not delete earlier transcript messages. Prefer an idempotent
“no unfinished goal” response that retains the achieved result, or document a
separate history-clearing action rather than calling it cancellation.

Evidence: [controller.ts](../.config/opencode/plugins/goal/controller.ts),
lines 111–115; [index.ts](../.config/opencode/plugins/goal/index.ts),
lines 395–402 and 458–462.

### F11. Multiple project instances can duplicate work or undo a stop

**Critical; source-confirmed and probe-confirmed with two runtimes.**

OpenCode loads a separate plugin instance for each location. In 2.0.3, the
Promise plugin's event iterator uses a context without `Location.Service`.
`Bus.local` returns the unfiltered stream when that service is absent. Each
loaded `GoalRuntime` can therefore receive the same session events. The local
handler checks only `data.sessionID`; it does not enforce session ownership.

Session actions operate by session ID. Storage is shared under the plugin ID,
not isolated by project. In contrast, controllers, queues, and success
deduplication flags are separate for each runtime.

Consequences:

- One interruption can produce several pause snapshots. The observed eight
  snapshots fit this behavior; the full event log was unavailable, so exact
  attribution of every snapshot is not proven.
- One success can cause several distinct queued continuation prompts.
- After the owning instance processes `/goal stop`, a second instance can still
  hold a cached active controller. A later success event can make it persist
  `active` again and submit another continuation.
- Merely changing a message label or retrying inactivity does not fix ownership.

The in-memory probe used two real `GoalRuntime` instances sharing one transcript
and prompt sink. Both received the execution-start event. The owner then
processed `/goal stop`. After both received success, the second instance wrote
an active snapshot and submitted a continuation.

Required direction: establish one authoritative handler for each goal/session.
Check canonical session ownership, including moves and workspaces. Make goal
transitions and continuation admission idempotent across instance changes. A
durable stop revision must win over stale caches and late events.

Sources, all at the shipped `v2.0.3` tag:

- [PluginHost event subscription](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/plugin/host.ts#L248-L257).
- [Bus filtering without an ambient location](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/bus.ts#L726-L762).
- [Plugin activation context](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/plugin.ts#L64-L74).
- [Promise iterator context and cleanup](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/plugin/src/promise/adapter.ts#L45-L74).
- [Session actions and shared storage prefix](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/plugin/host.ts#L505-L590).
- Local [index.ts](../.config/opencode/plugins/goal/index.ts), lines 149–155,
  241–274, 298–300, 576–651.

Normal adapter cleanup closes its iterators. There is no need to assume leaked
subscriptions after unload to explain this problem: concurrently loaded
instances are sufficient.

### F12. Core recovery has limits that the goal layer must not misinterpret

**Source-confirmed; not observed as the cause of the overnight stop.**

- Core permits **10 restart attempts per interrupted turn** by default. On the
  next attempt it emits `session.execution.failed` with the message
  `Execution was interrupted repeatedly and will not be resumed automatically.`
  The goal handler then takes the same permanent-pause path as other failures.
- `session.interrupt({ continue: true })` resumes pending steering input,
  compaction, or move work; queued goal continuations remain parked. It is not
  a general-purpose “resume this goal” API.
- Running background shell jobs are recovered with a cancellation notice after
  restart, not silently rerun. A still-enabled goal must assess that outcome
  before deciding which work remains safe.
- The goal's failure formatter keeps only an error message, discarding the
  structured error type. Recovery needs that distinction to separate safe
  admission retries from uncertain partial execution or a persistent crash.

Required direction: respect core's crash-loop protection. Keep the unfinished
goal visible and enabled while it waits for repair, rather than bypassing the
limit or silently abandoning the goal. Preserve structured stop/failure causes.

Evidence: [restart attempt budget and terminal failure](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/execution/restart.ts#L18-L98),
[background shell recovery](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/execution/restart.ts#L100-L134),
[interrupt continuation rules](https://github.com/anomalyco/opencode/blob/v2.0.3/packages/core/src/session/execution.ts#L155-L171),
and local [index.ts](../.config/opencode/plugins/goal/index.ts), lines 524–525,
675–679.

## Safe recovery boundaries

The following states must remain visible and recoverable without pretending that
the agent can always make progress:

| Condition | Required behavior |
| --- | --- |
| `/goal stop` | Durably cancel the goal; stop owned work and prevent all late reactivation. |
| Escape, stop-response button, or incidental session interruption | Stop that response, retain enabled goal intent, and reconcile before another attempt. |
| Inactivity eviction | Retain the goal and recover after cleanup. Diagnose a stalled tool rather than repeatedly executing it without review. |
| Service restart, reload, or stream reconnect | Restore state and reconcile core-owned work before scheduling more. |
| Provider failure, rate limit, or exhausted retry attempt | Wait with a stated reason and backoff. Retain the goal; do not bypass provider limits. |
| Pending question or permission | Wait for the user. Do not approve or repeatedly recreate the request automatically. |
| Long foreground tool or background job | Observe actual job state. Do not launch duplicate work or equate silence with completion. |
| No-tool response or repeated lack of progress | Retain the goal; reassess or enter a visible recoverable wait. Do not spin indefinitely. |
| Continuation/resource limit | Retain the goal and expose the limit. Apply a defined recovery policy, not a hidden permanent pause. |
| Agent reports a blocker | Preserve the goal and blocker. Continue independent safe work if possible; otherwise wait for the dependency. |
| Verified completion | Finish as achieved; this is not cancellation. Reject stale or insufficient completion evidence. |
| Revert, fork, move, archive, or deletion | Define ownership and lifecycle explicitly. Never silently copy live autonomy to another session or bypass an explicit stop through restored history. |

The last row needs a product decision for destructive session deletion: no
extension can recover a goal after all of its authoritative data is deliberately
removed. Either prevent deletion of an enabled goal until `/goal stop`, or
retain the goal outside the deleted session and define how it is recovered.
