# JSAN monitoring agent — network and data sheet for client security teams

Send this with an install link. It lists exactly what the one-line installer
changes, which connections it needs, and what data leaves the machine. How the
installer works internally: [agent installer](agent-installer.md).

Items marked **TO CONFIRM** depend on JSAN's production setup and must be
filled in before the sheet goes to a client.

## What the installer changes on the machine

| Change | Detail |
| --- | --- |
| Installs | Zabbix agent 2 (official package from repo.zabbix.com, or the signed MSI from cdn.zabbix.com on Windows) |
| Configures | Linux: `/etc/zabbix/zabbix_agent2.d/opsdesk.conf`, with the same settings commented out (`# opsdesk:`) in the stock `zabbix_agent2.conf`; Windows: a marked block in the agent's config. One encryption key file readable only by the agent (Linux `/etc/zabbix/opsdesk.psk`, `0600 zabbix:zabbix`; Windows SYSTEM + Administrators) |
| Service | `zabbix-agent2` started and enabled |
| OS packages | **Not touched** unless the client adds `--upgrade` (Linux). Windows Update is never touched. The machine is never rebooted |
| Existing Zabbix agent | Left alone (ours uses its own local port 31050) |
| Remote commands | Not enabled: JSAN can read metrics, not run commands on the machine |
| Undo | `--uninstall` (Linux) or `$env:OPSDESK_UNINSTALL='1'` (Windows) removes the service, package, key and config |

Needs root / Administrator. Never prompts; safe to re-run (it repairs).

## Network: outbound only, no inbound port

The agent listens on `127.0.0.1` only. Nothing needs to be opened inbound and no
VPN is used.

| From | To | Port | When | Why |
| --- | --- | --- | --- | --- |
| The machine | OpsDesk API, **TO CONFIRM** (`API_PUBLIC_URL`) | TCP 443 (HTTPS) | Install only | Download the installer, register the machine, confirm it works |
| The machine (Linux) | `repo.zabbix.com` | TCP 443 | Install only | Zabbix package repository (signed) |
| The machine (Linux) | The OS's own package mirrors | TCP 443/80 as already configured | Install only | `apt-get update` / `dnf` to install the agent package and its dependencies |
| The machine (Windows) | `cdn.zabbix.com` | TCP 443 | Install only | Agent MSI (Authenticode signature checked) |
| The machine | JSAN Zabbix server, **TO CONFIRM** (stable JSAN host name and port) | TCP, **TO CONFIRM** | Always | The agent sends its data, TLS-PSK encrypted |

The installer checks each connection before changing anything and names the
host and port to open if one is blocked.

**Not supported yet:** machines that reach the internet only through an HTTP
proxy, or not at all. The agent's protocol can't pass an HTTP proxy. Such sites
need a JSAN collector (Zabbix proxy) inside the site instead.

## What is sent to JSAN

At registration (once per install):

- host name, OS name and version, the machine's IPv4 address;
- the hardware serial / service tag (to match the machine to its asset record);
- a one-way hash of the machine id (Linux `/etc/machine-id`, Windows
  `MachineGuid`), never the id itself.

Ongoing, through the agent: the items of the stock Zabbix templates "Linux by
Zabbix agent active" / "Windows by Zabbix agent active" — CPU, memory, swap,
file systems, network interfaces, system uptime and OS details (Windows also
service states). **TO CONFIRM:** the exact item list of the template version in
production, attached for the client.

No file contents, application data or logs are collected by these templates.

## Where the data is stored, and for how long

| Question | Answer |
| --- | --- |
| Where | **TO CONFIRM**: hosting provider and region of the JSAN Zabbix server and the OpsDesk database |
| Metric history retention | **TO CONFIRM**: Zabbix housekeeping settings (history / trends) |
| Who can see it | JSAN staff with access to the client's site in OpsDesk (role- and site-scoped), and the client's own OpsDesk users for their site |
| Encryption in transit | TLS-PSK between agent and server, a separate key per machine; HTTPS to OpsDesk |
| Audit | Every link created or revoked and every machine enrolled is recorded in OpsDesk's audit trail, with the client's change reference when one was given |

## Governance controls on the link

- Each link is for one site, enrolls at most the number of machines JSAN set,
  and expires (3 days by default, 30 at most). JSAN can revoke it at any time.
- A machine is matched to its asset record by serial. One that isn't in the
  asset register is added as *planned, awaiting review* until JSAN confirms it.
- A machine can't take over another machine's enrollment, or an asset at
  another site.
