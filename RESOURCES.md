# AFK Pi Extension Resources

## Knowledge

### Primary source (start here)
- [Pi AFK via Photon — extension README](.pi/agent/extensions/afk/README.md)
  The authoritative operator's guide for the version installed in this checkout: setup,
  environment variables, reply format, session keys, subagent suppression, secret
  handling. Use for: anything you actually need to do at the keyboard or on the phone.

### Implementation in this checkout
- [`index.ts`](.pi/agent/extensions/afk/index.ts)
  The `/afk` command, the `on` / `off` / `status` arguments, the `✉ afk <key>` status
  footer, notification triggers (question, blocked, idle), and what happens to an
  inbound reply while Pi is busy. Use for: exact wording of the messages Pi sends you
  and the exact conditions that suppress AFK.
- [`protocol.ts`](.pi/agent/extensions/afk/protocol.ts)
  `shortSessionKey` (the eight-character key) and `parseRemoteQuestionAnswer` (the reply
  grammar and every rejection message). Use for: settling arguments about what a valid
  reply looks like.
- [`routing.mjs`](.pi/agent/extensions/afk/routing.mjs)
  How a reply is matched to a session: explicit key prefix, bare number when exactly one
  session is waiting on a question, single-session fallback, otherwise ambiguous. Use
  for: multi-session routing questions.
- [`client.ts`](.pi/agent/extensions/afk/client.ts)
  Broker launch, reconnect behaviour, and the log path used when the connection fails.
  Use for: recovery and troubleshooting.
- [`broker.mjs`](.pi/agent/extensions/afk/broker.mjs)
  The single local process that owns the Photon connection and fans replies out to
  concurrent sessions. Use for: understanding the "no enabled session" and "more than
  one session" replies you get back on your phone.

### Host platform
- [Pi extensions documentation](/Users/jose/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md)
  How Pi extensions register commands, flags, status items, and lifecycle hooks. Use
  for: understanding why AFK is session-scoped and why non-TUI processes behave
  differently.

### Transport
- [Spectrum — Introduction (Photon)](https://photon.codes/docs/spectrum-ts/introduction)
  What Spectrum is: one agent, many messaging interfaces, iMessage among them. Use for:
  the mental model of the delivery layer.
- [Spectrum — iMessage provider (Photon)](https://photon.codes/docs/spectrum-ts/providers/imessage)
  The managed cloud iMessage provider this extension uses, and its configuration. Use
  for: provider setup and understanding managed lines.
- [Photon API reference — Introduction](https://photon.codes/docs/api-reference/introduction)
  Project credentials and API surface. Use for: where `PHOTON_PROJECT_ID` and
  `PHOTON_PROJECT_SECRET` come from.
- [Photon dashboard](https://app.photon.codes)
  Where you create the project and enable iMessage.

## Wisdom (Communities)

No community source has been verified for this local extension yet.

## Gaps

- No public community exists yet for this specific extension; it is local to this
  dotfiles checkout. Troubleshooting wisdom has to come from reading the source above
  and from asking the agent.
- No resource covers running AFK across several machines. Treat it as unexplored.
