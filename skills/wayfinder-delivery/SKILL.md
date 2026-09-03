---
name: wayfinder-delivery
description: Carry a huge chunk of work — more than one agent session can hold — to its destination through a shared map of decision and delivery tickets on your issue tracker.
disable-model-invocation: true
---

A loose idea has arrived — too big for one agent session, and wrapped in fog. The way from here to the **destination** is not visible yet. Wayfinding charts that way as a **shared map** on the repo's issue tracker, then works its tickets one at a time until the destination is reached.

The destination shapes every ticket. It might be an approved spec, a settled decision, a migrated data structure, or a working product proved in use. Name the destination before charting the route.

## Reach the destination

The map is complete when the destination exists and its stated proof is satisfied. A clear route is progress, not completion.

Decisions come before the delivery work that depends on them. Create decision tickets while the route is uncertain. Graduate implementation, validation, and release work into delivery tickets as soon as their boundaries become clear. Keep work whose shape still depends on open decisions in the fog.

Do not turn visible fog into a speculative build plan. Each delivery ticket must follow settled decisions, fit one agent session, and move the map toward its destination.

## Refer by name

Every map and ticket is an issue, so it has a **name** — its title. In everything the human reads — narration and the map's Progress-so-far — refer to it by that name, never by a bare id, number, or slug. A name wraps its link; the id and URL ride inside the name.

## The Map

The map is a single issue on this repo's issue tracker, labelled `wayfinder:map`. It is the canonical artifact. Its tickets are child issues of the map.

The map is an **index**, not a store. It lists closed decisions and delivery outcomes and points at the tickets that hold their detail. An outcome lives in exactly one place — its ticket — so the map only gists it and links.

**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if not. Consult the tracker doc's "Wayfinding operations" section for how this repo expresses them. If no tracker has been provided, default to the local-markdown tracker.

### The map body

Load this low-resolution view once per session. Open tickets are not listed — find them through the tracker's child-issue query.

```markdown
## Destination

<what reaching the end of this map looks like and what proves it; one or two lines>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Progress so far

<!-- one line per closed ticket: enough to judge relevance, then follow the link for detail -->

- [<closed ticket title>](link) — <one-line gist of the decision or delivery outcome>

## Not yet specified

<!-- in-scope fog whose question or delivery boundary is not precise yet -->

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a child issue of the map. The tracker's issue id is its identity. Size each ticket to one 100K-token agent session.

Decision ticket body:

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Delivery ticket body:

```markdown
## Task

<the bounded work this ticket completes>

## Completion criteria

<observable proof that the work is complete>
```

Each ticket carries one `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.

A session **claims** a ticket by assigning it to the dev driving the map, first, before any work. That assignee is the claim. An open, unassigned ticket is unclaimed.

Blocking uses the tracker's native dependency relationship so the human can see the frontier in the tracker UI. Only a tracker without native blocking falls back to a body convention. A ticket is **unblocked** when every ticket blocking it is closed. The **frontier** is the open, unblocked, unclaimed children.

Record the answer or completed outcome in a resolution comment, not the ticket body. Link assets from the issue instead of pasting them into it.

## Ticket Types

Every ticket is either **HITL** — human in the loop, worked with a human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL ticket resolves only through that live exchange; the agent never stands in for the human.

- **Research** (AFK): Read documentation, third-party APIs, or resources outside the current working directory to surface facts a decision needs. Resolve it through a `/research` subagent. Capture findings on a throwaway `research/<name>` branch and link the artifact from the ticket.
- **Prototype** (HITL): Raise the fidelity of a decision with a cheap, rough artifact to react to through the `/prototype` skill. Link the prototype as an asset.
- **Grilling** (HITL): Resolve a decision through conversation. Always invoke the `/grilling` and `/domain-modeling` skills.
- **Task** (HITL or AFK): Complete bounded delivery work after its governing decisions are settled, or manual work needed to unblock a decision. State observable completion criteria. Record what changed, where its artifacts live, and what proof passed.

## Fog of war

The map is deliberately incomplete. Beyond the live tickets lies the **fog of war** — decisions or delivery boundaries that are in scope but not precise because they depend on work still open. Resolving a ticket clears the fog ahead of it, graduating what is now specifiable into fresh tickets.

Write that dim view in **Not yet specified**. It is a signpost, not a backlog.

**Fog or ticket?** The test is whether you can state the question or bounded task precisely now, not whether you can complete it now.

- Create a ticket when the question is sharp or the delivery boundary and proof are known, even when blocked.
- Keep it in Not yet specified when you cannot yet phrase it that sharply.

Do not pre-slice fog. One patch can graduate into several tickets, one ticket, or none.

Not yet specified excludes settled work in Progress so far, live tickets, and work beyond the destination.

## Out of scope

Fog gathers only toward the destination. Work beyond the destination belongs in **Out of scope**. It never graduates unless the destination is redrawn as a fresh effort.

When an existing ticket proves to sit beyond the destination, close it and add one linked line to Out of scope with the reason. Do not add it to Progress so far because it did not advance the route.

## Invocation

Two modes. Either way, never resolve more than one ticket per session, except parallel research tickets created while charting.

### Chart the map

The user invokes with a loose idea.

1. **Name the destination.** Run `/grilling` and `/domain-modeling` to define the result and its proof. The destination fixes scope.
2. **Map the frontier.** Grill breadth-first across the whole space. Surface the open decisions and any delivery work whose boundaries are already clear. If this reveals no fog and the destination fits one session, stop and ask how the user wants to proceed.
3. **Create the map** with `wayfinder:map`. Fill Destination and Notes, leave Progress-so-far empty, and sketch the fog in Not yet specified.
4. **Create every ticket that is precise now** as a child issue. Create all issues first, then wire blocking edges in a second pass. Keep decision-dependent delivery work in the fog.
5. **Fire the research subagents.** Resolve each new research ticket in parallel through `/research`, with its findings on a throwaway branch and a context pointer from the ticket.
6. Stop. Charting creates the shared route but resolves no non-research ticket.

### Work through the map

The user invokes with a map URL or number. A ticket is optional; without one, choose the next frontier ticket.

1. Load the map's low-resolution body, not every ticket.
2. Choose the named ticket or the first frontier ticket in order. Claim it before any work.
3. Work by ticket type. Resolve a decision or complete the delivery task. Zoom into related tickets only as needed and invoke every skill named in Notes.
4. Post the answer or delivery outcome as a resolution comment, close the ticket, and append one context pointer to Progress so far.
5. Create and wire newly visible tickets. Graduate cleared fog and remove each graduated patch from Not yet specified. Close and record anything newly exposed as out of scope.
6. Check the destination. If no ticket remains but the destination or its proof is incomplete, chart the next delivery frontier. Close the map only when the destination is reached, its proof passes, no in-scope ticket remains, and Not yet specified is empty.

Other sessions may work unblocked tickets in parallel. Expect concurrent tracker edits and reload tracker state before each mutation.
