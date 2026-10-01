# Local monitoring stack

Runs Prometheus, Alertmanager, Loki and Grafana as native Windows binaries (no
Docker) so the OpsDesk alert pipeline can be exercised against the real tools.
Metrics and log bodies stay in these tools; OpsDesk only receives normalized
alerts (ADR-003).

```
windows_exporter ──> Prometheus ──> Alertmanager ──> POST /api/v1/alerts/sources/alertmanager
dev log files ──> Alloy ──> Loki
                                 Grafana reads Prometheus + Loki
```

## Ports

Everything binds to `127.0.0.1` only — Prometheus, Alertmanager and Loki have no
authentication.

| Tool             | Port  | URL                                                  |
| ---------------- | ----- | ---------------------------------------------------- |
| Grafana          | 3001  | http://127.0.0.1:3001 (`admin` / `admin` first time) |
| Prometheus       | 9090  | http://127.0.0.1:9090                                |
| Alertmanager     | 9093  | http://127.0.0.1:9093                                |
| Loki             | 3100  | API only — browse logs in Grafana                    |
| Loki gRPC        | 9096  | internal                                             |
| windows_exporter | 9182  | http://127.0.0.1:9182/metrics                        |
| Alloy            | 12345 | http://127.0.0.1:12345                               |

Grafana's default port 3000 is the OpsDesk API, hence 3001. The provisioned
dashboard is **OpsDesk → OpsDesk local monitoring**.

Zabbix is not part of this stack: Zabbix server has no Windows build, so it
needs a Linux host (WSL, a VM or a hosted service). Its OpsDesk endpoint is
`POST /api/v1/alerts/sources/zabbix`.

## Run

```powershell
.\infra\monitoring\local\start-monitoring.ps1
.\infra\monitoring\local\stop-monitoring.ps1
```

After editing `prometheus.yml` or `rules/*.yml`:
`curl -X POST http://127.0.0.1:9090/-/reload`.

## Install

Binaries, data and logs live outside the repo in `%USERPROFILE%\devtools\monitoring`
(pass `-DevTools` to use another folder):

| Download (windows-amd64)                 | Extract to                          |
| ---------------------------------------- | ----------------------------------- |
| Prometheus zip                           | `monitoring\prometheus-<version>\`  |
| Alertmanager zip                         | `monitoring\alertmanager-<version>\` |
| Grafana OSS zip                          | `monitoring\grafana-<version>\`     |
| Loki `loki-windows-amd64.exe.zip`        | `monitoring\bin\`                   |
| Alloy `alloy-windows-amd64.exe.zip`      | `monitoring\bin\`                   |
| windows_exporter `...-amd64.exe`         | `monitoring\bin\windows_exporter.exe` |

Set up with Prometheus 3.15.0, Alertmanager 0.34.1, Loki 3.7.8, Alloy 1.20.1,
Grafana 13.2.3 and windows_exporter 0.31.8.

## API token

Alertmanager authenticates to OpsDesk with a machine API token read from
`secrets/opsdesk-api-token` (gitignored). To issue one: sign in as a Super
Admin, `POST /api/v1/admin/users/<userId>/api-tokens` for a user holding an alert
ingest role (e.g. Service Desk / NOC), and save the returned `token` value in
that file with no trailing newline.

## What reaches OpsDesk

`prometheus.yml` labels this machine as the seeded CI `SITE02-SRV-001`; the
`site` and `ci` labels are what OpsDesk resolves an alert against. The rules in
`rules/opsdesk-host.yml` are all `warning`: under the default OpsDesk alert rule
a `critical` alert emails the NOC roster and opens a P1 incident.

To see an alert travel end to end, stop `windows_exporter` for two minutes —
`HostExporterDown` appears in Prometheus, Alertmanager and the OpsDesk Alerts
list — then run the start script again and it turns `RECOVERED`.
