# Starts the local site lab: the dev TLS proxy in front of the API, the
# iDRAC/iLO simulators + control panel, and the real site collector pointed at
# them. Local development only. See README.md.
#
# Requires: `pnpm dev:api` running on :3000, and secrets\opsdesk-api-token +
# secrets\bmc-credential (README.md, "One-time setup").
$ErrorActionPreference = "Stop"

$lab = $PSScriptRoot
$repo = Resolve-Path (Join-Path $lab "..\..")
$secrets = Join-Path $lab "secrets"
$run = Join-Path $lab ".run"
New-Item -ItemType Directory -Force $run | Out-Null

$tokenFile = Join-Path $secrets "opsdesk-api-token"
$credFile = Join-Path $secrets "bmc-credential"
foreach ($f in @($tokenFile, $credFile)) {
  if (-not (Test-Path $f)) { throw "Missing $f - see README.md (One-time setup)." }
}
$node = (Get-Command node).Source
# The simulated BMCs mint a self-signed cert on first run. openssl ships with
# Git for Windows but usually isn't on the Windows PATH.
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  $openssl = @(
    (Join-Path $env:ProgramFiles "Git\usr\bin\openssl.exe"),
    (Join-Path $env:ProgramFiles "Git\mingw64\bin\openssl.exe")
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $openssl) { throw "openssl not found - install Git for Windows or put openssl on PATH." }
$pnpm = Join-Path $env:APPDATA "npm\node_modules\pnpm\bin\pnpm.cjs"

function Test-Listening([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Test-Running([string]$name) {
  $pidFile = Join-Path $run "$name.pid"
  if (-not (Test-Path $pidFile)) { return $false }
  return [bool](Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue)
}

function Start-Node([string]$name, [string[]]$arguments, [hashtable]$environment) {
  foreach ($k in $environment.Keys) { Set-Item "env:$k" $environment[$k] }
  try {
    $process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $repo `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $run "$name.log") `
      -RedirectStandardError (Join-Path $run "$name.err.log")
  } finally {
    foreach ($k in $environment.Keys) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
  }
  Set-Content -Path (Join-Path $run "$name.pid") -Value $process.Id -Encoding ascii
  Write-Host ("{0,-10} started (pid {1})" -f $name, $process.Id)
}

if (-not (Test-Listening 3000)) {
  Write-Warning "Nothing on :3000 - start the API (pnpm dev:api) or the collector's deliveries will buffer."
}

Write-Host "building site-lab and collector..."
& $node $pnpm --filter "@cts-dc-opsdesk/site-lab" --filter "@cts-dc-opsdesk/collector" build | Out-Null
if ($LASTEXITCODE -ne 0) { throw "build failed" }

# 1. TLS in front of the API (the collector only speaks https to the API)
if (Test-Listening 8443) {
  Write-Host "tls-proxy  already listening on 8443"
} else {
  Start-Node "tls-proxy" @("scripts\dev-tls-proxy.mjs") @{}
  $cert = Join-Path $repo ".dev-tls\cert.pem"
  for ($i = 0; $i -lt 40 -and -not (Test-Path $cert); $i++) { Start-Sleep -Milliseconds 250 }
}

# 2. Simulated BMCs + control panel
$credential = (Get-Content $credFile -Raw).Trim()
if (Test-Listening 8600) {
  Write-Host "site-lab   already listening on 8600"
} else {
  Start-Node "site-lab" @("tools\site-lab\dist\index.js") @{ SITE_LAB_BMC_CREDENTIAL = $credential; SITE_LAB_OPENSSL = $openssl }
}

# 3. The real collector, with its config rendered from collector.site-lab.json
if (Test-Running "collector") {
  Write-Host "collector  already running"
} else {
  $config = Get-Content (Join-Path $lab "collector.site-lab.json") -Raw | ConvertFrom-Json
  $config.apiToken = (Get-Content $tokenFile -Raw).Trim()
  $config.bufferFile = (Join-Path $run "collector-buffer.json")
  $rendered = Join-Path $secrets "collector.json"
  # BOM-less: Windows PowerShell 5.1's "utf8" writes a BOM, which JSON.parse rejects
  [IO.File]::WriteAllText($rendered, ($config | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
  Start-Node "collector" @("apps\collector\dist\index.js") @{
    COLLECTOR_CONFIG_FILE      = $rendered
    NODE_EXTRA_CA_CERTS        = (Join-Path $repo ".dev-tls\cert.pem")
    COLLECTOR_CRED_SITE_LAB_BMC = $credential
  }
}

Write-Host ""
Write-Host "Control panel:  http://127.0.0.1:8600"
Write-Host "Logs:           $run"
