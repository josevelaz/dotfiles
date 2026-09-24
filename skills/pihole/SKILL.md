---
name: pihole
description: Pi-hole diagnosis over Tailscale SSH. Use when Pi-hole is not working on the network, LAN DNS is broken, or ads aren't blocked.
---

# Pi-hole

Health is a client query to the Pi's **LAN** address. `tailscale ssh` is the **admin path** — it opens the box; it does not prove the **DNS path**.

Keep every probe's stdout in the conversation. Leave the filesystem untouched on this Mac and on the Pi: no debug logs, captures, reports, or `pihole debug` dumps.

```bash
pi="$HOME/.agents/skills/pihole/scripts/pi"
"$pi" '<remote-command>'
```

Pipes belong inside that one quoted string so they run on the Pi. v6 speaks `pihole-FTL --config`; v5 speaks `/etc/pihole/setupVars.conf`. Use what exists. If Pi-hole is Docker-only, wrap FTL/CLI in `docker exec <container>` and keep `:53` checks on the host.

## 1. Reach the Pi

```bash
"$pi" 'hostname; ip -br -4 addr; command -v pihole; command -v pihole-FTL; docker ps --format "{{.Names}}" 2>/dev/null | grep -i pihole || true'
```

If that fails, run `tailscale status` on this Mac. Name whether `pi` is online and reachable. Stop until the admin path works.

**Done when:** one `scripts/pi` command has returned hostname, IPv4 addresses, and how Pi-hole is installed (host binary, Docker, or missing).

## 2. Tight probe for the symptom

Map "not working" to one **red**-capable probe against the **LAN** IPv4 from step 1 — not the tailnet `100.x` address, not this Mac's default resolver.

| Symptom | Tight probe |
| --- | --- |
| No DNS / no internet | `dig +time=2 +tries=1 @<lan-ip> example.com` |
| Ads not blocked | `dig +time=2 +tries=1 @<lan-ip> doubleclick.net` (expect the configured blocking reply) |
| Some devices only | Same probes, then compare query-log lines for a failing client vs a working one |
| Admin UI down | `"$pi" 'pihole-FTL --config webserver.port; ss -lntp'` |

This Mac often uses MagicDNS. `dig example.com` here is hop 0 on the Mac, not the LAN probe.

If this Mac cannot reach `<lan-ip>:53`, say so. Instrument from the Pi and give the user one command to run on a failing device.

**Done when:** you have run one named command, pasted its output, and it is **red** on the stated symptom — or you have proven the LAN path is unreachable from here and switched to Pi-side telemetry plus a user-run probe.

## 3. Walk the hops

Find the first broken **hop**. Run every probe. Change one hop at a time.

### 0 — Client resolver

This Mac: `scutil --dns`; `tailscale status`; `dig +time=2 +tries=1 example.com`; `dig +time=2 +tries=1 @<lan-ip> example.com`.

Pi: `"$pi" 'journalctl -u pihole-FTL -n 80 --no-pager; tail -n 50 /var/log/pihole/pihole.log 2>/dev/null || true'`

Silent query log while the user browses → clients are not using this Pi-hole (router DHCP, IPv6 RA DNS, Android Private DNS, iCloud Private Relay, hardcoded `8.8.8.8`). This Mac's MagicDNS success is local, not LAN health.

### 1 — LAN:53

```bash
"$pi" 'ss -ulnp; ss -lntp; pihole-FTL --config dns.interface; pihole-FTL --config dns.listeningMode; pihole-FTL --config dns.port'
```

v5: `grep -E 'PIHOLE_INTERFACE|IPV4_ADDRESS|DNSMASQ_LISTENING' /etc/pihole/setupVars.conf`.

- Nothing on `:53` / FTL inactive / disk full → `systemctl restart pihole-FTL`
- Another process owns `:53` → stop it; keep FTL on 53
- FTL on `lo` / `tailscale0` only → `dns.interface` / `dns.listeningMode` for LAN; `pihole reloaddns`
- Docker FTL healthy, host has no `:53` → publish `53/udp` and `53/tcp` on the LAN interface

If `<lan-ip>` is reachable from here: `dig +time=2 +tries=1 @<lan-ip> pi.hole`

### 2 — FTL

```bash
"$pi" 'pihole status; systemctl status pihole-FTL --no-pager || docker ps --filter name=pihole; pihole-FTL --config dns.blocking.active; pihole-FTL --config dns.blocking.mode; ls -l /etc/pihole/gravity.db; df -h / /etc/pihole'
```

Blocking disabled with working DNS → `pihole enable`. Gravity missing/tiny/stale → `pihole updateGravity`.

### 3 — Upstream

```bash
"$pi" 'pihole-FTL --config dns.upstreams; pihole-FTL --config dns.revServers; cat /etc/resolv.conf; tailscale status; tailscale debug prefs; dig +time=2 +tries=1 @127.0.0.1 example.com'
```

Then `dig` each upstream from the Pi. v5: `PIHOLE_DNS_*` in `setupVars.conf`.

- Upstreams empty/dead → set working upstreams; `pihole reloaddns`
- `/etc/resolv.conf` is MagicDNS or `127.0.0.1` and AcceptDNS is on → on the Pi: `tailscale set --accept-dns=false`, then fix resolv/upstreams
- Upstream is the router that uses this Pi-hole → real upstream (or unbound on another port); router DNS stays the Pi

**Done when:** every hop has probe output, and you can name the first failure.

## 4. Isolate and fix

State the prediction, then apply the smallest reversible fix that hop predicts. Leave router DHCP, phone Private DNS, and iCloud Private Relay as exact user instructions.

Re-run the step 2 probe. Green on the original symptom is the only success.

**Done when:** the tight probe is green, or the remaining fix is off-box and written as a concrete instruction.

## 5. Report

In the conversation only: cause, hop, evidence (command + output), what changed, what the user still has to change.
