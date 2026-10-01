# Starts the local monitoring stack (native Windows binaries, no Docker):
# windows_exporter -> Prometheus -> Alertmanager -> OpsDesk API, and
# Alloy -> Loki, with Grafana on top. Everything binds to 127.0.0.1 only —
# Prometheus, Alertmanager and Loki have no authentication.
#
# Binaries, data and logs live outside the repo under <DevTools>\monitoring;
# only configuration is version-controlled here. See README.md.
param(
  [string]$DevTools = (Join-Path $env:USERPROFILE "devtools")
)

$ErrorActionPreference = "Stop"

$config = $PSScriptRoot
$root = Join-Path $DevTools "monitoring"
$data = Join-Path $root "data"
$logs = Join-Path $root "logs"
$pids = Join-Path $root "pids"

if (-not (Test-Path $root)) {
  throw "Monitoring binaries not found at $root - see README.md (Install)."
}
# Grafana does not create its own data directory.
foreach ($dir in @($data, $logs, $pids, (Join-Path $data "grafana"))) {
  New-Item -ItemType Directory -Force $dir | Out-Null
}

function Resolve-Tool([string]$pattern) {
  $match = Get-ChildItem -Path $root -Filter $pattern -Directory | Sort-Object Name | Select-Object -Last 1
  if (-not $match) { throw "No directory matching $pattern under $root - see README.md (Install)." }
  return $match.FullName
}

function Test-Listening([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Start-Tool([string]$name, [int]$port, [string]$exe, [string[]]$arguments) {
  if (Test-Listening $port) {
    Write-Host ("{0,-17} already listening on {1}" -f $name, $port)
    return
  }
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.out.log") `
    -RedirectStandardError (Join-Path $logs "$name.log")
  Set-Content -Path (Join-Path $pids "$name.pid") -Value $process.Id -Encoding ascii
  Write-Host ("{0,-17} started on {1} (pid {2})" -f $name, $port, $process.Id)
}

$tokenFile = Join-Path $config "secrets\opsdesk-api-token"
if (-not (Test-Path $tokenFile)) {
  Write-Warning "No OpsDesk API token at $tokenFile - alerts will not reach OpsDesk. See README.md (API token)."
}

$prometheusHome = Resolve-Tool "prometheus-*"
$alertmanagerHome = Resolve-Tool "alertmanager-*"
$grafanaHome = Resolve-Tool "grafana-*"

# Loki, Alloy and Grafana read these (forward slashes: they end up inside YAML
# and Alloy string values).
$env:LOKI_DATA_DIR = (Join-Path $data "loki") -replace "\\", "/"
$env:OPSDESK_DEVTOOLS_DIR = $DevTools -replace "\\", "/"
$env:OPSDESK_GRAFANA_DASHBOARDS = Join-Path $config "grafana\dashboards"
$env:GF_SERVER_HTTP_ADDR = "127.0.0.1"
# 3000 is the OpsDesk API.
$env:GF_SERVER_HTTP_PORT = "3001"
$env:GF_PATHS_DATA = Join-Path $data "grafana"
$env:GF_PATHS_LOGS = Join-Path $logs "grafana"
$env:GF_PATHS_PROVISIONING = Join-Path $config "grafana\provisioning"
$env:GF_ANALYTICS_REPORTING_ENABLED = "false"
$env:GF_ANALYTICS_CHECK_FOR_UPDATES = "false"
# Keep the datasource plugins that ship in the Grafana zip. Left on, Grafana
# downloads newer plugin builds at startup, and Windows Smart App Control blocks
# those fresh binaries ("An Application Control policy has blocked this file"),
# which unregisters the Prometheus datasource.
$env:GF_PLUGINS_PREINSTALL_DISABLED = "true"

Start-Tool "windows_exporter" 9182 (Join-Path $root "bin\windows_exporter.exe") @(
  "--web.listen-address=127.0.0.1:9182",
  "--collectors.enabled=cpu,memory,logical_disk,net,os,system"
)

Start-Tool "prometheus" 9090 (Join-Path $prometheusHome "prometheus.exe") @(
  "--config.file=`"$(Join-Path $config "prometheus.yml")`"",
  "--storage.tsdb.path=`"$(Join-Path $data "prometheus")`"",
  "--storage.tsdb.retention.time=7d",
  "--web.listen-address=127.0.0.1:9090",
  # Lets `POST /-/reload` pick up edited rules without a restart.
  "--web.enable-lifecycle"
)

Start-Tool "alertmanager" 9093 (Join-Path $alertmanagerHome "alertmanager.exe") @(
  "--config.file=`"$(Join-Path $config "alertmanager.yml")`"",
  "--storage.path=`"$(Join-Path $data "alertmanager")`"",
  "--web.listen-address=127.0.0.1:9093",
  "--cluster.listen-address="
)

Start-Tool "loki" 3100 (Join-Path $root "bin\loki-windows-amd64.exe") @(
  "-config.file=`"$(Join-Path $config "loki.yaml")`"",
  "-config.expand-env=true"
)

Start-Tool "alloy" 12345 (Join-Path $root "bin\alloy-windows-amd64.exe") @(
  "run",
  "`"$(Join-Path $config "config.alloy")`"",
  "--server.http.listen-addr=127.0.0.1:12345",
  "--storage.path=`"$(Join-Path $data "alloy")`"",
  "--disable-reporting"
)

Start-Tool "grafana" 3001 (Join-Path $grafanaHome "bin\grafana.exe") @(
  "server",
  "--homepath=`"$grafanaHome`""
)

Write-Host ""
Write-Host "Grafana       http://127.0.0.1:3001   (admin / admin on first sign-in)"
Write-Host "Prometheus    http://127.0.0.1:9090"
Write-Host "Alertmanager  http://127.0.0.1:9093"
Write-Host "Loki          http://127.0.0.1:3100   (API only - browse logs in Grafana)"
Write-Host "Logs          $logs"
