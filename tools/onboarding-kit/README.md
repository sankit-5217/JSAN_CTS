# Client onboarding kit

Brings a new client site under JSAN monitoring: a Zabbix **proxy** at the
client office connects **out** to the JSAN Zabbix server over a PSK-encrypted
link, polls the client's devices read-only, and every problem flows into
OpsDesk as an alert (and, for Disaster-level problems, a P1 incident).

```
JSAN (once)                    JSAN (per client)                         Client
setup-central.mjs  ──►  onboard-site.mjs --inventory devices.csv  ──►  bundle  ──►  sudo bash install-proxy.sh proxy.env
                                 │                                                         │
                                 └──────────────  check-site.mjs --site SITE03  ◄──────────┘
```

| File                    | Who runs it | What it does                                                                                   |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `setup-central.mjs`     | JSAN, once  | UPS-MIB template, OpsDesk webhook, dedicated webhook user, action. Re-runnable.                |
| `onboard-site.mjs`      | JSAN        | Validates the inventory, then creates the site, CMDB items, proxy + key, hosts; writes the bundle |
| `client/install-proxy.sh` | Client    | Installs and connects the proxy (and an agent for the proxy VM). Re-runnable.                 |
| `check-site.mjs`        | JSAN        | Go-live checklist; exit code 0 only when everything passes                                     |

## Prerequisites (JSAN)

- Zabbix 7.0 server reachable by clients on TCP 10051 at a fixed name, e.g.
  `monitor.jsan.example`. A laptop or WSL is fine for testing only (see below).
- The OpsDesk API reachable from the Zabbix server (for the webhook).
- `secrets/zabbix-api-token`: a Zabbix API token (Users → API tokens) for an
  admin user. `secrets/` and `out/` are gitignored.
- OpsDesk Super Admin credentials: `OPSDESK_ADMIN_EMAIL` (default
  `admin@example.com`) and `OPSDESK_ADMIN_PASSWORD` or `secrets/opsdesk-admin-password`.
- Optional env: `ZABBIX_URL`, `OPSDESK_API`, `WEBHOOK_URL` (the URL the Zabbix
  *server* uses to reach OpsDesk).

## Onboard a client

1. **Once:** `node tools/onboarding-kit/setup-central.mjs`
2. Get the client's device list into a CSV (see `test/site03-demo-inventory.csv`).
3. Check it without changing anything:
   ```
   node tools/onboarding-kit/onboard-site.mjs --site SITE04 --name "Acme Pune" \
     --timezone Asia/Kolkata --server monitor.jsan.example --inventory acme.csv --dry-run
   ```
4. Run it again without `--dry-run`. It writes `out/SITE04/`:
   - `proxy.env` — **secret** (the proxy key). Send it through a secure channel.
   - `install-proxy.sh` and `CLIENT-README.txt` — send to the client.
5. The client runs `sudo bash install-proxy.sh proxy.env` on their proxy VM.
6. `node tools/onboarding-kit/check-site.mjs --site SITE04` until it shows 0 failed.
7. In OpsDesk → Administration → Users, give the site's engineers access to SITE04.

## Inventory CSV

Columns: `host,name,type,address,port,snmp_version,snmp_community,v3_user,
v3_auth_protocol,v3_auth_pass,v3_priv_protocol,v3_priv_pass,v3_context,
manufacturer,model,criticality,location`. Lines starting with `#` are ignored.

- `host` must start with the site code (`SITE04-FW-001`) and becomes both the
  Zabbix host name and the OpsDesk CMDB code.
- `type`: `firewall-fortigate`, `firewall`, `switch`, `router`, `ups`, `pdu`,
  `wifi-controller`, `cctv-nvr`, `access-control`, `isp-link`, `generic-snmp`,
  `ping-only`, `server-linux`, `server-windows`. `template` can override the
  Zabbix template.
- SNMP: `snmp_version` 3 (default; `authPriv`, SHA256/AES128 unless given) or
  `2c` with `snmp_community`. Credentials are stored as **secret** Zabbix macros.
- Wi-Fi, CCTV and access control are stored in the CMDB as `SERVICE` with the
  kind in metadata, until OpsDesk gets dedicated CI types.

## What the kit refuses (nothing is created when any check fails)

- Hosts not prefixed with the site code, duplicates, unknown types or columns,
  bad addresses or ports, an unquoted comma that shifts columns.
- Missing or short SNMP credentials, unknown SNMPv3 protocols.
- The same address and port twice behind the same proxy.
- A Zabbix host or CMDB record that already belongs to another site or proxy.
- Missing central setup (webhook disabled, action missing, template missing).
- An existing proxy whose key is not in `out/<SITE>/proxy.env` (Zabbix never
  reveals a key). Re-run with `--rotate-psk` and reinstall the bundle.

Warnings (not fatal): SNMP v2c, well-known communities, MD5/SHA1/DES.

Re-running `onboard-site.mjs` is safe: existing objects are updated, nothing is
duplicated, and the proxy key stays the same unless `--rotate-psk` is given.

## Client installer

`install-proxy.sh` (Ubuntu 22.04/24.04, Debian 12, systemd) checks DNS and the
outbound TCP connection first, installs Zabbix 7.0 with service autostart
blocked (so default configs never start), writes the config, builds the proxy
database from the shipped schema, and waits for JSAN to hand over its
configuration. If JSAN refuses the key or cannot be reached it stops the proxy
and says why, instead of retrying forever. The optional local agent is
active-only and opens no port.

## Testing on one PC (WSL)

`test/` contains a pretend client office used to verify the kit:

```powershell
# a clean, separate Ubuntu machine for the "client"
wsl --import jsan-client-site03 C:\Users\<you>\wsl\jsan-client-site03 ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz
wsl -d jsan-client-site03 -u root -- bash <repo>/tools/onboarding-kit/test/demo-client-devices.sh <repo>/tools/client-site-lab/snmprec
node tools/onboarding-kit/onboard-site.mjs --site SITE03 --name "Acme Pune office (test)" --timezone Asia/Kolkata \
  --server 127.0.0.1:10051 --proxy-listen-port 10063 --inventory tools/onboarding-kit/test/site03-demo-inventory.csv
# copy out/SITE03/{install-proxy.sh,proxy.env} into the client machine and run the installer there
node tools/onboarding-kit/check-site.mjs --site SITE03
node tools/onboarding-kit/test/e2e-site03.mjs
node --test tools/onboarding-kit/test/inventory.test.mjs
```

All WSL machines share one network, so the test proxy uses port 10063 instead
of 10051 (the central server's). **WSL stops a distro that has no open
session**, which silently stops its proxy or Zabbix server. Keep it awake
(`wsl -d <distro> -- sleep infinity` in a hidden window) or set
`instanceIdleTimeout=-1` under `[general]` in `%USERPROFILE%\.wslconfig`.
Real client VMs do not have this problem.

## Offboarding a client

Disable the site's hosts and proxy in Zabbix (Data collection → Hosts / Proxies),
set the CMDB items to RETIRED in OpsDesk, and ask the client to run
`systemctl disable --now zabbix-proxy zabbix-agent` and remove the key file
`/etc/zabbix/zabbix_proxy.psk`.
