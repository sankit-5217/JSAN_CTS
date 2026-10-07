# Site lab (local only)

Runs the **real site collector** (`apps/collector`) end to end on a developer
machine, against simulated hardware:

| Piece                    | Where                    | What it is                                                                                                              |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Simulated **Dell iDRAC** | `https://127.0.0.1:8601` | Redfish service (Basic auth, self-signed cert) for `SITE01-R01-SRV-001`. Sends iDRAC SNMP traps from `127.0.0.11`.      |
| Simulated **HPE iLO**    | `https://127.0.0.1:8602` | Redfish + `Oem.Hpe` for `SITE01-R01-DB-001`. Sends CPQIDA/CPQHLTH traps from `127.0.0.12`.                              |
| **Control panel**        | `http://127.0.0.1:8600`  | Fail, degrade, predict-fail or repair a drive, PSU or fan, and see when the collector last polled.                      |
| **TLS proxy**            | `https://127.0.0.1:8443` | `scripts/dev-tls-proxy.mjs` in front of `pnpm dev:api`. The collector only speaks https to the API (ADR-004).           |
| **Collector**            | udp/1162 for traps       | The production collector, configured by `collector.site-lab.json`. It polls both BMCs every 30 s and pushes to the API. |

A component change does what real hardware does. The BMC's Redfish tree
changes, so the next collector poll raises or recovers a per-part alert. The
matching vendor trap is also sent immediately as a real UDP SNMPv2c datagram,
so the SNMP path raises or clears its alert within seconds. The trap OIDs and
varbinds are the IDRAC-MIB / CPQIDA / CPQHLTH ones that
`integrations/snmp/src/vendor-traps.ts` recognises, and the tests in
`src/site-lab.spec.ts` run the simulated output through the real adapters.

> **Never deploy this.** It binds 127.0.0.1 only. The simulated BMCs accept
> one local credential, and the proxy uses a throwaway self-signed cert.

## One-time setup

Both secrets live in `tools/site-lab/secrets/`, which is gitignored.

1. `secrets/bmc-credential` holds `user:password`, which the simulated BMCs
   accept and the collector uses. Any value works, for example
   `opsdesk-ro:<random>`.
2. `secrets/opsdesk-api-token` holds an `odk_…` machine token for a user with
   an alert ingest role. To create one, sign in as a Super Admin and call
   `POST /api/v1/admin/users/<userId>/api-tokens` with
   `{"name":"Site lab collector (SITE01, local)","expiresInDays":365}` for
   `servicedesk@example.com`. The token value is returned once; save it to
   the file. Revoke it under Administration, then Users, then Tokens.

## Run

```powershell
pnpm dev:api                                      # API on :3000 (separate terminal)
powershell -File tools\site-lab\start-site-lab.ps1
# ... open http://127.0.0.1:8600
powershell -File tools\site-lab\stop-site-lab.ps1
```

The start script builds the site lab and collector packages, then starts the
proxy, simulators and collector hidden. It writes logs and pid files to
`tools/site-lab/.run/`. A step whose port is already in use is skipped.

## Try it

1. Open the control panel. Each server card shows "last polled N s ago" once
   the collector is running.
2. Click **Predict fail** on a drive, or **Degrade** on a PSU.
   - Within seconds an SNMP alert appears under Alerts in OpsDesk, for
     example `hardware.drive_fault` WARNING on `Disk.Bay.2:…`.
   - Within one poll (30 s) a Redfish alert appears too, for example
     `hardware.drive_predictive_failure` on `DRIVE:Physical Disk 0:1:2`.
   - Both attach to the CI's open incident, if there is one.
3. Click **Repair**. The "OK" trap clears the SNMP alert, and the next poll
   clears the Redfish one.

**Fail** (Critical) behaves like production. Under the default alert rule it
opens a **P1 incident and pages the NOC roster by email**, so the button asks
for confirmation first.

Real HPE iLOs have no per-fan "OK" trap. In the lab, as on real hardware, a
repaired HPE fan only clears when the next Redfish poll sees it.

## Moving to real hardware

The collector is the production one. For a real site, copy
`collector.site-lab.json` and make these changes:

- Point `endpoints[].address` at the real iDRAC or iLO.
- Set `endpointTlsInsecure` to match the BMC certificates.
- List the BMCs' real source IPs under `snmpSources`.
- Set `apiBaseUrl` to the real API, with mTLS via `tls`.
- Supply credentials through `COLLECTOR_CRED_<REF>`, or a vault-backed
  resolver.
- On each BMC, configure the trap destination to point at the collector.
