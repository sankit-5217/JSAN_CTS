# One-line monitoring agent installer

Clients put a server under JSAN monitoring with one command. No VPN and no
inbound port: the agent connects **out** to the JSAN Zabbix server, encrypted.

```
Linux   (root):         curl -fsSL https://<api>/api/v1/enroll/<code>/install.sh | sudo bash
Windows (admin PS):     irm https://<api>/api/v1/enroll/<code>/install.ps1 | iex
Windows (curl.exe):     curl.exe -fsSL https://<api>/api/v1/enroll/<code>/install.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::In.ReadToEnd() | iex"
```

Linux options go after `bash -s --`: `--skip-upgrade`, `--name WEB01`, `--uninstall`.
Windows options are environment variables set first: `$env:OPSDESK_AGENT_NAME='WEB01'`,
`$env:OPSDESK_UNINSTALL='1'`.

## How it works

1. **Admin** (Super Admin / Delivery-Ops Manager): `POST /monitoring/agent-enrollments`
   `{ siteId, label?, expiresInDays (1-30, default 7) }`. The response carries the
   code and ready-made commands **once**; only a SHA-256 of the code is stored.
   The link works for **any number of that client's machines** until it expires
   or is revoked (`POST /monitoring/agent-enrollments/:id/revoke`).
2. **Client** runs the command. The script is generated per link
   (`GET /enroll/:code/install.sh|install.ps1`) with the API address, site,
   Zabbix version and agent server address filled in.
3. The script registers the machine (`POST /enroll/:code/register`). OpsDesk
   creates or refreshes the Zabbix host `<SITE>-<HOSTNAME>` (own PSK, `site`/`ci`
   tags, group `Clients/<SITE>`, template "Linux/Windows by Zabbix agent active")
   and a CMDB record (`SERVER`, managed by `SHARED`, criticality `MEDIUM` —
   edit it in the CMDB afterwards). Everything is audited as the admin who made
   the link (correlation id `agent-enrollment:<id>`).
4. The agent connects to the **agent server address** set in Monitoring →
   Zabbix settings (production: the Railway TCP proxy `iriguchi.proxy.rlwy.net:12762`).

Machines appear under Monitoring → Zabbix for engineers who have that site.

## Installer quality rubric

Every change to `apps/api/src/modules/monitoring/agent-enrollment/scripts/` must keep
all of these. IDs are referenced by the tests in `installer-scripts.spec.ts`.

| ID | Requirement | Linux | Windows |
| --- | --- | --- | --- |
| R1 | **Partial download never runs half the steps** | all code in functions, `main "$@"` is the last line | whole script inside one `& { … }` block |
| R2 | **Fails fast and loudly** | `set -Eeuo pipefail`, `ERR` trap with line + log path | `$ErrorActionPreference='Stop'`, `Set-StrictMode`, one catch printing the reason |
| R3 | **Needs admin rights, says so** | root check with the exact `sudo` command | Administrator check with "Run as administrator" hint |
| R4 | **Unattended — never prompts** | `DEBIAN_FRONTEND=noninteractive`, `NEEDRESTART_MODE=a`, `-y`, `--force-confdef/confold`, dpkg lock wait | `msiexec /qn /norestart` |
| R5 | **OS update as the client asked** | `apt-get update` + `upgrade` (or `dnf upgrade`), opt-out `--skip-upgrade`, **never reboots**, warns if a reboot is pending | not touched (Windows Update / WSUS) |
| R6 | **Supported OS detected, others refused clearly** | Ubuntu 20.04/22.04/24.04, Debian 11/12, RHEL-family 8/9; x86_64/aarch64 | 64-bit Windows |
| R7 | **Network checked before changing anything else** | HTTPS to OpsDesk + TCP to the Zabbix server, with the port to open | same |
| R8 | **No inbound exposure** | `ListenIP=127.0.0.1`, `Server=127.0.0.1` | same |
| R9 | **Encrypted, per-machine secret** | TLS-PSK both ways; key file `0600 zabbix:zabbix`; key never printed, logged or on a command line | key file ACL SYSTEM + Administrators only; never on the msiexec command line |
| R10 | **Trusted downloads only** | `https` + TLS ≥ 1.2 from repo.zabbix.com (signed repo) | MSI from cdn.zabbix.com, Authenticode signature checked |
| R11 | **Idempotent** | re-run = repair; one `opsdesk.conf`, stock keys commented, same host re-used | marked block replaced, MSI skipped when the version matches |
| R12 | **No silent takeover** | another machine with the same name is refused (machine-id hash); hosts of another site are refused | same |
| R13 | **Verifies the result with the server** | config test (`-T`), service active, then "Done" only when the JSAN Zabbix server confirms the agent (`POST /enroll/:code/status`, up to 2 min); otherwise the agent log reason and exit 2 | service running, same server confirmation |
| R14 | **Clear output** | numbered steps, final "Done … appears within a minute", log file | same, transcript log |
| R15 | **Reversible** | `--uninstall` | `$env:OPSDESK_UNINSTALL='1'` |
| R16 | **Served safely** | only `[A-Za-z0-9._:/-]` values are substituted into a script; unknown/expired/revoked code → 404; rate-limited | same |
| R17 | **Matches the server** | agent version series taken from the live Zabbix server, not hard-coded | exact MSI version from the server |
| R18 | **Lint-clean** | `bash -n`, and ShellCheck clean with `-o all` (only the pure-style SC2250/SC2292/SC2312 excluded) | PowerShell parser clean |
| R19 | **Coexists with an existing agent** | own loopback port 31050 (not 10050); an agent the client already runs is left alone | same |
| R20 | **A bad link fails clearly** | invalid/expired/revoked link (or server not ready) → a script that prints the reason and `exit 1`, served with HTTP 200 because `curl -f … \| bash` would otherwise show only "error: 404" and exit 0 | prints the reason and throws |
| R21 | **Every advertised one-liner really runs** | `curl -fsSL … \| sudo bash` run for real on a clean Ubuntu 24.04 (see Verification) | `irm … \| iex` and the curl.exe form verified; **not** `powershell -Command -`, which reads stdin line by line and silently skips the multi-line script |

## Troubleshooting

| Message | Fix |
| --- | --- |
| `This enrollment link is invalid, expired or revoked` | Create a new link for the site |
| `Cannot reach the JSAN Zabbix server at host:port` | Client firewall: allow outbound TCP to that port |
| `Another machine is already enrolled as …` | Two machines share a name: re-run with `--name` (Windows `$env:OPSDESK_AGENT_NAME`) |
| `AGENT_SERVER_ADDRESS_MISSING` when creating a link | Set the agent server address in Monitoring → Zabbix settings |
| Agent "reports a connection problem" | PSK mismatch after a manual edit or a blocked port: re-run the installer |
