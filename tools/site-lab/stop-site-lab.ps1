# Stops what start-site-lab.ps1 launched (tracked by pid file). A pid is only
# killed if it is still a node process running the expected script, since pids
# get reused after a reboot.
$run = Join-Path $PSScriptRoot ".run"
if (-not (Test-Path $run)) {
  Write-Host "Nothing to stop."
  return
}
$expected = @{
  "tls-proxy" = "dev-tls-proxy.mjs"
  "site-lab"  = "site-lab"
  "collector" = "collector"
}
foreach ($file in Get-ChildItem -Path $run -Filter "*.pid") {
  $name = $file.BaseName
  $processId = [int](Get-Content $file.FullName)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -like "*$($expected[$name])*") {
    Stop-Process -Id $processId -Force
    Write-Host ("{0,-10} stopped (pid {1})" -f $name, $processId)
  } else {
    Write-Host ("{0,-10} not running" -f $name)
  }
  Remove-Item $file.FullName
}
