# Mission: Using the AFK Pi extension confidently

## Why
The learner wants to use the AFK Pi extension installed in this checkout with
confidence: its commands, its lifecycle, and a safe operating workflow. The goal is
correct, deliberate operation of the handoff, not a general study of remote agents.

## Success looks like
- Enable, disable, and check AFK handoff for the current session with `/afk`.
- Answer a question from iMessage, including a custom answer when no choice fits.
- Continue a run that has gone idle or blocked, from the phone.
- Route a reply to the intended session when several sessions are AFK at once.
- Keep `PHOTON_PROJECT_SECRET` out of the repository and out of the Pi session.

## Constraints
- Short, practical lessons. 5-8 minutes each, one tangible win per lesson.
- Ground everything in the implementation living in this dotfiles checkout at
  [`.pi/agent/extensions/afk/`](.pi/agent/extensions/afk/README.md), not in generic
  advice about remote agents.
- Scope this workspace to the extension's current Photon Spectrum iMessage transport.

## Out of scope
- How the extension is built internally (broker protocol, socket framing, event wiring).
- Writing or modifying Pi extensions.
