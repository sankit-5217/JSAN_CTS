# Simulated end-to-end run of the Windows installer (install.ps1), no admin needed.
#
# Runs the REAL script logic in a throwaway folder. Only the commands that would
# change the machine or talk to JSAN are replaced by recording fakes (functions
# win over cmdlets/executables in PowerShell): msiexec via Start-Process, the
# service cmdlets, icacls, the MSI download/signature check and the OpsDesk API.
# The Zabbix server reachability check uses a real local TCP listener.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-ps1.sim.ps1
#
# Prints one "PASS"/"FAIL" line per check and exits 1 if any check failed.
param([string]$ScriptPath = (Join-Path $PSScriptRoot '..\scripts\install.ps1'))

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:Failures = 0
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Output "PASS  $Name" } else { $script:Failures++; Write-Output "FAIL  $Name $Detail" }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("opsdesk-ps1-sim-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$pf = Join-Path $root 'ProgramFiles'; $pd = Join-Path $root 'ProgramData'; $tmp = Join-Path $root 'Temp'
New-Item -ItemType Directory -Force -Path $pf, $pd, $tmp | Out-Null
$installDir = Join-Path $pf 'Zabbix Agent 2'
$confFile = Join-Path $installDir 'zabbix_agent2.conf'
$pskFile = Join-Path $installDir 'opsdesk.psk'

# A real listener stands in for the JSAN Zabbix server's public port.
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$zbxPort = $listener.LocalEndpoint.Port

$raw = Get-Content -Raw -Path $ScriptPath
$values = @{
  '__OPSDESK_API__' = 'https://opsdesk.sim/api/v1'; '__OPSDESK_CODE__' = ('A' * 43); '__OPSDESK_SITE__' = 'SITE04'
  '__OPSDESK_ZBX_VERSION__' = '7.0.31'; '__OPSDESK_ZBX_SERIES__' = '7.0'; '__OPSDESK_SERVER__' = "127.0.0.1:$zbxPort"
}
foreach ($k in $values.Keys) { $raw = $raw.Replace($k, $values[$k]) }
$sim = $raw.Replace('$env:ProgramFiles', "'$pf'").Replace('$env:ProgramData', "'$pd'").Replace('$env:TEMP', "'$tmp'")
$adminCheck = '$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
Check 'harness: admin check found in script' ($sim.Contains($adminCheck))
$simAdmin = $sim.Replace($adminCheck, '$true')

# ---------------------------------------------------------------- fakes
$script:Calls = New-Object System.Collections.Generic.List[string]
$script:Installed = $false
$script:StatusAnswers = @('UNKNOWN', 'AVAILABLE')
$script:RegisterMode = 'ok'
$script:LastRegisterBody = $null
$stockConf = @(
  '# stock config written by the Zabbix MSI (abridged)',
  'LogFile=zabbix_agent2.log',
  'Server=127.0.0.1',
  'ServerActive=127.0.0.1',
  'Hostname=Windows host',
  'Include=.\zabbix_agent2.d\plugins.d\*.conf'
)

function Start-Process {
  param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
  $script:Calls.Add("msiexec $ArgumentList")
  if ("$ArgumentList" -like '/i *') {
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    [IO.File]::WriteAllLines($confFile, $stockConf)
    $script:Installed = $true
  }
  if ("$ArgumentList" -like '/x *') { $script:Installed = $false }
  [pscustomobject]@{ ExitCode = 0 }
}
function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing) $script:Calls.Add("download $Uri"); Set-Content -Path $OutFile -Value 'fake msi' }
function Get-AuthenticodeSignature { param($FilePath) [pscustomobject]@{ Status = 'Valid' } }
function Get-ItemProperty {
  # Like the real cmdlet, accepts a path argument or registry keys from the pipeline.
  param([Parameter(ValueFromPipeline = $true)]$Path, $Name)
  process {
    if ($Path -is [pscustomobject]) { return $Path }
    if ("$Path" -like '*Cryptography*') { return [pscustomobject]@{ MachineGuid = '11111111-2222-3333-4444-555555555555' } }
    if ("$Path" -like '*Uninstall*' -and $script:Installed) {
      return [pscustomobject]@{ DisplayName = 'Zabbix Agent 2 (64-bit)'; DisplayVersion = '7.0.31.0'; PSChildName = '{SIM-PRODUCT-CODE}' }
    }
  }
}
function Get-ChildItem {
  param($Path, $ErrorAction)
  if ($script:Installed) { [pscustomobject]@{ DisplayName = 'Zabbix Agent 2 (64-bit)'; DisplayVersion = '7.0.31.0'; PSChildName = '{SIM-PRODUCT-CODE}' } }
}
function Set-Service { param($Name, $StartupType) $script:Calls.Add("set-service $Name $StartupType") }
function Restart-Service { param($Name, [switch]$Force) $script:Calls.Add("restart-service $Name") }
function Get-Service { param($Name) [pscustomobject]@{ Status = 'Running' } }
function Start-Sleep { param($Seconds) }
function icacls.exe { $script:Calls.Add("icacls $args") }
function Invoke-RestMethod {
  param($Uri, $Method, $ContentType, $Body, $TimeoutSec)
  if ($Uri -like '*/health/live') { return 'ok' }
  if ($Uri -like '*/register') {
    $script:LastRegisterBody = $Body | ConvertFrom-Json
    if ($script:RegisterMode -eq 'conflict') {
      $err = New-Object System.Management.Automation.ErrorRecord(
        (New-Object Exception 'Response status code does not indicate success: 409 (Conflict).'), 'WebErr', 'InvalidOperation', $null)
      $err.ErrorDetails = New-Object System.Management.Automation.ErrorDetails '{"message":"Another machine is already enrolled as SITE04-SIMHOST."}'
      throw $err
    }
    return [pscustomobject]@{ hostName = 'SITE04-SIMHOST'; serverActive = "127.0.0.1:$zbxPort"; pskIdentity = 'opsdesk-SITE04-SIMHOST'; psk = ('ab' * 32) }
  }
  if ($Uri -like '*/status') {
    $answer = if ($script:StatusAnswers.Count -gt 0) { $script:StatusAnswers[0] } else { 'UNKNOWN' }
    if ($script:StatusAnswers.Count -gt 1) { $script:StatusAnswers = $script:StatusAnswers[1..($script:StatusAnswers.Count - 1)] }
    return [pscustomobject]@{ hostName = 'SITE04-SIMHOST'; agent = $answer }
  }
  throw "unexpected API call $Uri"
}

function Invoke-Installer([string]$Text) {
  $env:OPSDESK_AGENT_NAME = 'SIMHOST'
  # Write-Host output goes to the information stream (6) on PowerShell 5+.
  $out = (& ([scriptblock]::Create($Text)) 6>&1 *>&1 | Out-String)
  Remove-Item Env:OPSDESK_AGENT_NAME -ErrorAction SilentlyContinue
  return $out
}
function Get-ActiveKeys { (Get-Content $confFile) | Where-Object { $_ -match '^[A-Za-z]+=' } }

try {
  # 1. The real Administrator check, in this non-admin shell.
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $out = Invoke-Installer $sim
    Check 'R3  refuses to run without Administrator and says how' ($out -match 'Run as administrator')
    Check 'R3  nothing installed when refused' (-not (Test-Path $confFile))
  }

  # 2. First install.
  $script:Calls.Clear()
  $out = Invoke-Installer $simAdmin
  $keys = Get-ActiveKeys
  Check 'R14 first install reports Done after server confirmation' ($out -match 'Confirmed: the JSAN Zabbix server' -and $out -match 'Done\. SITE04-SIMHOST is now monitored')
  Check 'R7  network checked before the MSI download' (($out.IndexOf('reachable')) -lt ($out.IndexOf('Installing Zabbix agent 2')))
  Check 'R4  MSI silent, no reboot' (@($script:Calls | Where-Object { $_ -like 'msiexec /i*' -and $_ -like '*/qn /norestart*' }).Count -eq 1)
  Check 'R9  key never on the msiexec command line' (-not @($script:Calls | Where-Object { $_ -like 'msiexec*' -and $_ -like '*abab*' }))
  Check 'R9  key file written with the server-issued key' ((Get-Content -Raw $pskFile) -eq ('ab' * 32))
  Check 'R9  key file ACL locked to SYSTEM + Administrators' (@($script:Calls | Where-Object { $_ -like 'icacls*inheritance:r*S-1-5-18*S-1-5-32-544*' }).Count -eq 1)
  Check 'R8  ListenIP 127.0.0.1 and Server 127.0.0.1' (($keys -contains 'ListenIP=127.0.0.1') -and ($keys -contains 'Server=127.0.0.1'))
  Check 'R19 own local port 31050' ($keys -contains 'ListenPort=31050')
  Check 'R9  TLS-PSK both ways' (($keys -contains 'TLSConnect=psk') -and ($keys -contains 'TLSAccept=psk'))
  Check 'R11 stock keys commented, exactly one value each' ((@($keys | Where-Object { $_ -like 'Server=*' }).Count -eq 1) -and ((Get-Content $confFile) -contains '# opsdesk: Hostname=Windows host'))
  Check 'R12 machine id sent as a 32-hex hash' ($script:LastRegisterBody.machineId -match '^[a-f0-9]{32}$' -and $script:LastRegisterBody.os -eq 'windows')
  Check 'R13 service set to Automatic and restarted' (($script:Calls -contains 'set-service Zabbix Agent 2 Automatic') -and ($script:Calls -contains 'restart-service Zabbix Agent 2'))
  Check 'R14 transcript log written' (Test-Path (Join-Path $pd 'OpsDesk\agent-install.log'))

  # 3. Re-run = repair.
  $script:Calls.Clear(); $script:StatusAnswers = @('AVAILABLE')
  $out = Invoke-Installer $simAdmin
  $conf = Get-Content $confFile
  Check 'R11 re-run: MSI skipped when the version matches' (-not @($script:Calls | Where-Object { $_ -like 'msiexec*' }) -and $out -match 'Already installed')
  Check 'R11 re-run: still one OpsDesk block and one Hostname' ((@($conf | Where-Object { $_ -eq '# >>> OpsDesk' }).Count -eq 1) -and (@(Get-ActiveKeys | Where-Object { $_ -like 'Hostname=*' }).Count -eq 1))
  Check 'R11 re-run: reports Done' ($out -match 'Done\.')

  # 4. Server never confirms.
  $script:StatusAnswers = @('UNKNOWN')
  $out = Invoke-Installer $simAdmin
  Check 'R13 no confirmation: warns, never says Done' (($out -match 'did not confirm the agent') -and ($out -notmatch 'Done\.'))

  # 5. Registration refused.
  $before = Get-Content -Raw $confFile
  $script:RegisterMode = 'conflict'; $script:StatusAnswers = @('AVAILABLE')
  $out = Invoke-Installer $simAdmin
  Check 'R12 refused registration: clear reason shown' ($out -match 'OpsDesk refused the registration' -and $out -match 'Another machine is already enrolled')
  Check 'R12 refused registration: agent config left untouched' ((Get-Content -Raw $confFile) -eq $before)
  $script:RegisterMode = 'ok'

  # 6. Uninstall.
  $script:Calls.Clear(); $env:OPSDESK_UNINSTALL = '1'
  $out = Invoke-Installer $simAdmin
  Remove-Item Env:OPSDESK_UNINSTALL
  Check 'R15 uninstall: msiexec /x with the product code' (@($script:Calls | Where-Object { $_ -like 'msiexec /x {SIM-PRODUCT-CODE}*' }).Count -eq 1)
  Check 'R15 uninstall: key file removed' (-not (Test-Path $pskFile))
  Check 'R15 uninstall: says JSAN still lists the machine' ($out -match 'JSAN still lists the machine')
} finally {
  $listener.Stop()
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}

Write-Output ("{0} check(s) failed" -f $script:Failures)
if ($script:Failures -gt 0) { exit 1 }
