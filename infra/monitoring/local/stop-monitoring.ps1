# Stops the processes start-monitoring.ps1 launched (tracked by pid file).
param(
  [string]$DevTools = (Join-Path $env:USERPROFILE "devtools")
)

$pids = Join-Path $DevTools "monitoring\pids"
if (-not (Test-Path $pids)) {
  Write-Host "Nothing to stop."
  return
}

# Process names the pid files may legitimately point at — a pid can be reused
# by an unrelated process after a reboot, and that one must not be killed.
$expected = @{
  windows_exporter = "windows_exporter"
  prometheus       = "prometheus"
  alertmanager     = "alertmanager"
  loki             = "loki-windows-amd64"
  alloy            = "alloy-windows-amd64"
  grafana          = "grafana"
}

foreach ($file in Get-ChildItem -Path $pids -Filter "*.pid") {
  $name = $file.BaseName
  $processId = [int](Get-Content $file.FullName)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq $expected[$name]) {
    Stop-Process -Id $processId -Force
    Write-Host ("{0,-17} stopped (pid {1})" -f $name, $processId)
  } else {
    Write-Host ("{0,-17} not running" -f $name)
  }
  Remove-Item $file.FullName
}
