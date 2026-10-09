# Client site lab (local only)

A pretend **client office, SITE02**, on your own machine. It is monitored the
way a real client site would be: a **Zabbix proxy** at the site watches the
devices locally and connects **out** to the central Zabbix server over a
PSK-encrypted link. The client opens no inbound ports, and no management
interface is exposed (spec §3, ADR-004).

```
 "Client office" (WSL loopback)                        "JSAN" (your machine)
 ┌──────────────────────────────────────┐              ┌───────────────────────┐
 │ SITE02-FW-001  FortiGate  127.0.0.21 │──SNMP──┐     │ Zabbix server :10051  │
 │ SITE02-SW-001  switch     127.0.0.22 │──SNMP──┤     │  │ webhook            │
 │ SITE02-UPS-001 UPS-MIB    127.0.0.23 │──SNMP──┼─► SITE02-PROXY ──PSK──►      │
 │ SITE02-ISP-001 ISP gw     127.0.0.30 │──ping──┤   (active, outbound)  ▼     │
 │ SITE02-SRV-001 Linux + Zabbix agent  │─active─┘     │ OpsDesk API :3000     │
 └──────────────────────────────────────┘              │  /alerts/sources/zabbix│
                                                       │  /monitoring/zabbix/* │
                                                       └───────────────────────┘
```

Every device is tagged `site=SITE02` and `ci=<its CMDB code>` in Zabbix, and
has a matching CMDB item in OpsDesk. Only users with SITE02 access (plus the
all-site roles) see it.

> **Never deploy this.** The SNMP devices are simulated (snmpsim) with the
> community `public`, bound to loopback only.

## Prerequisites

- Zabbix 7.0 server + frontend running in WSL Ubuntu 24.04, and
  `%USERPROFILE%\.wslconfig` with `networkingMode=mirrored`. See
  `docs/runbooks/zabbix-integration.md`.
- OpsDesk API on `:3000`, seeded (sites SITE01/SITE02, demo users).
- `secrets/zabbix-api-token` holding a Zabbix API token (Users → API tokens).
  The folder is gitignored.

## Set up (once, re-runnable)

```powershell
# 1. Ubuntu side: proxy, simulated devices, client server agent (as root)
wsl -d Ubuntu-24.04 -u root -- bash "/mnt/c/<repo>/tools/client-site-lab/setup-wsl.sh"
# 2. Register everything in Zabbix and OpsDesk
node tools\client-site-lab\provision.mjs
```

`provision.mjs` creates, idempotently:

| Where   | What                                                                                 |
| ------- | ------------------------------------------------------------------------------------ |
| Zabbix  | Proxy `SITE02-PROXY` (active, PSK identity `SITE02-PROXY`)                            |
| Zabbix  | Template `OpsDesk UPS-MIB by SNMP` (RFC 1628, vendor-neutral, 15 items, 6 triggers)   |
| Zabbix  | 5 hosts in group `Client SITE02`, monitored by the proxy, tagged `site` and `ci`      |
| Zabbix  | Media type `OpsDesk` (webhook) and action `Send problems to OpsDesk`                  |
| Zabbix  | User `opsdesk-webhook` (read-only, no frontend) that receives the OpsDesk media       |
| OpsDesk | 5 CMDB items in SITE02, and an `odk_` token for the webhook (`secrets/`)              |

The webhook sends problems, recoveries and acknowledgements for any event
carrying a `site` tag to `POST /api/v1/alerts/sources/zabbix`.

The webhook goes to a dedicated `opsdesk-webhook` user on purpose. Zabbix
never sends an update notification to the user who made the update, and
acknowledgements from OpsDesk are made as the API token's user. If that user
also received the webhook, OpsDesk acks would never be echoed back.

## Break things

```powershell
powershell -File tools\client-site-lab\lab.ps1 status
powershell -File tools\client-site-lab\lab.ps1 ups-on-battery
```

| Command                        | What happens                         | Zabbix   | OpsDesk                         |
| ------------------------------ | ------------------------------------ | -------- | ------------------------------- |
| `ups-on-battery`               | Mains fails, UPS on battery          | High     | HIGH alert                      |
| `ups-battery-low`              | 4 min of runtime left                | Disaster | CRITICAL alert + **P1 incident** |
| `ups-overload`                 | Load 92 % (after 2 min)              | Warning  | WARNING alert                   |
| `ups-normal`                   | Mains back                           | resolved | alerts RECOVERED                |
| `wan-down` / `wan-up`          | Firewall wan1 (ISP-A) link           | Average  | HIGH alert                      |
| `isp-down` / `isp-up`          | ISP gateway stops answering (~3 min) | High     | HIGH alert                      |
| `fw-cpu-high` / `fw-cpu-normal` | Firewall CPU 97 % (after 5 min)     | Warning  | WARNING alert                   |
| `port-down N` / `port-up N`    | Switch port Gi1/0/N                  | Average  | HIGH alert                      |
| `offline fw\|sw\|ups` / `online …` | Device stops answering SNMP      | Warning  | WARNING alert                   |
| `reset`                        | Everything back to normal            |          |                                 |

Then watch **OpsDesk → Monitoring → Zabbix** (live problems, acknowledge),
**Alerts**, and **Incidents**. Acknowledging in OpsDesk writes to Zabbix, and
Zabbix echoes the acknowledgement back, so the OpsDesk alert turns
ACKNOWLEDGED too.

CRITICAL alerts also page the NOC roster. Emails only go out while
`pnpm dev:worker` runs.

## Smoke test

```powershell
node tools\client-site-lab\smoke.mjs          # ~10 min, includes the ISP ping case
node tools\client-site-lab\smoke.mjs --quick  # skips the ISP case
```

It resets the lab, runs the faults above end to end, and prints PASS/FAIL with
how long each one took to reach OpsDesk. Each run leaves one P1 test incident
open in OpsDesk.

## Files

| File               | Purpose                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `setup-wsl.sh`     | Installs and starts the proxy, snmpsim devices and second agent (systemd units) |
| `gen-snmprec.mjs`  | Generates `snmprec/*.snmprec`, the simulated devices' SNMP data                 |
| `provision.mjs`    | Registers proxy, template, hosts, webhook, action, CMDB items                   |
| `lab.sh`, `lab.ps1` | Fault controls (`/usr/local/bin/opsdesk-lab` inside WSL)                       |
| `smoke.mjs`        | End-to-end test                                                                  |

## Real client sites

For a real client the shape is the same. Put one small Linux VM at the client
office running `zabbix-proxy` in active mode with a PSK, pointed at a Zabbix
server it can reach, such as a cloud VM. The laptop's WSL copy is for testing
only. Then give each device read-only SNMP, tag the hosts `site` and `ci`, and
install agents only on servers.

## Remove

```bash
# in WSL as root
systemctl disable --now zabbix-proxy opsdesk-site02-agent opsdesk-snmpsim@SITE02-{FW,SW,UPS}-001
rm -rf /opt/opsdesk-client-lab /etc/zabbix/client-lab /usr/local/bin/opsdesk-lab
```

Then delete the hosts, proxy, template, media type and action in Zabbix, and
retire the SITE02 CMDB items in OpsDesk.
