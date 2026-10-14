# JSAN OpsDesk - monitoring agent installer for Windows
# Site: __OPSDESK_SITE__
#
# Run in PowerShell opened with "Run as administrator":
#   irm __OPSDESK_API__/enroll/<code>/install.ps1 | iex
#
# Options (set before running the line above):
#   $env:OPSDESK_AGENT_NAME = 'WEB01'   enroll this machine under another name
#   $env:OPSDESK_UNINSTALL  = '1'       remove the agent and its configuration
#
# What it does, unattended: checks that OpsDesk and the JSAN Zabbix server are
# reachable, registers this machine with OpsDesk (site __OPSDESK_SITE__),
# installs Zabbix agent 2 __OPSDESK_ZBX_VERSION__ (official MSI from cdn.zabbix.com) and connects it
# OUT to the JSAN Zabbix server, encrypted (TLS-PSK). The agent only listens on
# 127.0.0.1, so no inbound port is opened. Safe to run again.
# Log: C:\ProgramData\OpsDesk\agent-install.log

# Everything runs inside this block: a partially downloaded script fails to
# parse instead of running half its steps.
& {
  Set-StrictMode -Version 2.0
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $OpsdeskApi = '__OPSDESK_API__'
  $EnrollCode = '__OPSDESK_CODE__'
  $SiteCode = '__OPSDESK_SITE__'
  $ZbxVersion = '__OPSDESK_ZBX_VERSION__'
  $ZbxSeries = '__OPSDESK_ZBX_SERIES__'
  $ZbxServer = '__OPSDESK_SERVER__'

  $ServiceName = 'Zabbix Agent 2'
  $InstallDir = Join-Path $env:ProgramFiles 'Zabbix Agent 2'
  $ConfFile = Join-Path $InstallDir 'zabbix_agent2.conf'
  $PskFile = Join-Path $InstallDir 'opsdesk.psk'
  $AgentLog = Join-Path $InstallDir 'zabbix_agent2.log'
  $LogDir = Join-Path $env:ProgramData 'OpsDesk'
  $LogFile = Join-Path $LogDir 'agent-install.log'
  $MsiUrl = "https://cdn.zabbix.com/zabbix/binaries/stable/$ZbxSeries/$ZbxVersion/zabbix_agent2-$ZbxVersion-windows-amd64-openssl.msi"
  $script:Step = 0
  $StepTotal = 6

  function Write-Step([string]$Text) {
    $script:Step++
    Write-Host ''
    Write-Host ("[{0}/{1}] {2}" -f $script:Step, $StepTotal, $Text)
  }
  function Fail([string]$Text) {
    throw "$Text (full log: $LogFile)"
  }

  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERROR: open PowerShell with "Run as administrator" and run the command again.' -ForegroundColor Red
    return
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Host 'ERROR: 64-bit Windows is required.' -ForegroundColor Red
    return
  }
  # TLS 1.2 for older Windows / PowerShell 5.1 defaults.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  try { Stop-Transcript | Out-Null } catch { }
  Start-Transcript -Path $LogFile -Append | Out-Null
  try {
    Write-Host ("JSAN OpsDesk monitoring agent installer - site {0} - {1:u}" -f $SiteCode, (Get-Date).ToUniversalTime())

    if ($env:OPSDESK_UNINSTALL -eq '1') {
      $StepTotal = 1
      Write-Step 'Removing the OpsDesk monitoring agent'
      $product = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        Get-ItemProperty | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'Zabbix Agent 2*' } | Select-Object -First 1
      if ($product) {
        $p = Start-Process msiexec.exe -ArgumentList "/x $($product.PSChildName) /qn /norestart" -Wait -PassThru
        if ($p.ExitCode -notin 0, 1605, 3010) { Fail "Uninstall failed (msiexec exit code $($p.ExitCode))" }
      }
      Remove-Item -Force -ErrorAction SilentlyContinue $PskFile
      Write-Host 'Done. The agent is removed from this machine.'
      Write-Host 'JSAN still lists the machine until an admin removes it in OpsDesk / Zabbix.'
      return
    }

    Write-Step 'Checking this machine and the network'
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Host "  $($os.Caption) ($($os.OSArchitecture))"
    try { Invoke-RestMethod -Uri "$OpsdeskApi/health/live" -TimeoutSec 20 | Out-Null }
    catch { Fail "Cannot reach OpsDesk at $OpsdeskApi over HTTPS. Allow outbound HTTPS (443) from this machine." }
    $zHost, $zPort = $ZbxServer -split ':'
    $tcp = New-Object Net.Sockets.TcpClient
    try {
      $connect = $tcp.BeginConnect($zHost, [int]$zPort, $null, $null)
      if (-not $connect.AsyncWaitHandle.WaitOne(10000) -or -not $tcp.Connected) { throw 'timeout' }
    } catch {
      Fail "Cannot reach the JSAN Zabbix server at $ZbxServer. Allow outbound TCP $zPort from this machine (no inbound port is needed)."
    } finally { $tcp.Close() }
    Write-Host '  OpsDesk and the JSAN Zabbix server are reachable'

    Write-Step 'Operating system updates - not touched on Windows (use Windows Update / WSUS)'

    Write-Step "Installing Zabbix agent 2 ($ZbxVersion)"
    $installed = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'Zabbix Agent 2*' } | Select-Object -First 1
    if ($installed -and $installed.DisplayVersion -like "$ZbxVersion*") {
      Write-Host "  Already installed ($($installed.DisplayVersion))"
    } else {
      $msi = Join-Path $env:TEMP "zabbix_agent2-$ZbxVersion.msi"
      try { Invoke-WebRequest -Uri $MsiUrl -OutFile $msi -UseBasicParsing }
      catch { Fail "Could not download the Zabbix agent from $MsiUrl (outbound HTTPS needed)." }
      $sig = Get-AuthenticodeSignature $msi
      if ($sig.Status -ne 'Valid') { Fail "The downloaded MSI is not validly signed ($($sig.Status)); not installing it." }
      # Placeholder settings only - the real ones (incl. the key) are written
      # to the config file below, never put on a command line.
      $msiLog = Join-Path $LogDir 'agent-msi.log'
      $msiArgs = "/i `"$msi`" /qn /norestart /l*v `"$msiLog`" SERVER=127.0.0.1 SERVERACTIVE=127.0.0.1 LISTENIP=127.0.0.1 LISTENPORT=31050"
      $p = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru
      Remove-Item -Force -ErrorAction SilentlyContinue $msi
      if ($p.ExitCode -notin 0, 3010) { Fail "The Zabbix agent MSI failed (exit code $($p.ExitCode)); see $msiLog" }
    }
    if (-not (Test-Path $ConfFile)) { Fail "Zabbix agent 2 config not found at $ConfFile after install." }

    Write-Step 'Registering this machine with OpsDesk'
    $name = if ($env:OPSDESK_AGENT_NAME) { $env:OPSDESK_AGENT_NAME } else { $env:COMPUTERNAME }
    if ($name -notmatch '^[A-Za-z0-9._-]{1,60}$') { Fail "Machine name '$name' may only use letters, digits, '.', '_' and '-'; set `$env:OPSDESK_AGENT_NAME." }
    $guid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
    $sha = [Security.Cryptography.SHA256]::Create()
    $machineHash = (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($guid)) | ForEach-Object { $_.ToString('x2') })).Substring(0, 32)
    $address = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
    $body = @{ hostname = $name; os = 'windows'; osVersion = $os.Caption; machineId = $machineHash; address = "$address" } | ConvertTo-Json
    try {
      $reg = Invoke-RestMethod -Method Post -Uri "$OpsdeskApi/enroll/$EnrollCode/register" -ContentType 'application/json' -Body $body -TimeoutSec 60
    } catch {
      $detail = $_.ErrorDetails.Message
      if (-not $detail) { $detail = $_.Exception.Message }
      Fail "OpsDesk refused the registration: $detail"
    }
    if (-not ($reg.hostName -and $reg.serverActive -and $reg.pskIdentity -and $reg.psk)) { Fail 'OpsDesk answered, but the registration details were incomplete.' }
    Write-Host "  Enrolled as $($reg.hostName)"

    Write-Step 'Configuring the agent (encrypted, outbound only)'
    Set-Content -Path $PskFile -Value $reg.psk -Encoding Ascii -NoNewline
    # Only SYSTEM (the agent service) and Administrators may read the key.
    & icacls.exe $PskFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    $owned = 'Server', 'ServerActive', 'Hostname', 'HostnameItem', 'ListenIP', 'ListenPort', 'TLSConnect', 'TLSAccept', 'TLSPSKIdentity', 'TLSPSKFile'
    $lines = New-Object System.Collections.Generic.List[string]
    $inBlock = $false
    foreach ($line in (Get-Content -Path $ConfFile)) {
      if ($line -eq '# >>> OpsDesk') { $inBlock = $true; continue }
      if ($line -eq '# <<< OpsDesk') { $inBlock = $false; continue }
      if ($inBlock) { continue }
      $key = ($line -split '=', 2)[0]
      if ($owned -contains $key) { $lines.Add("# opsdesk: $line") } else { $lines.Add($line) }
    }
    $lines.Add('# >>> OpsDesk')
    $lines.Add("# Managed by the JSAN OpsDesk agent installer (site $SiteCode). Re-run it to change these.")
    $lines.Add("Hostname=$($reg.hostName)")
    $lines.Add("ServerActive=$($reg.serverActive)")
    $lines.Add('Server=127.0.0.1')
    $lines.Add('ListenIP=127.0.0.1')
    # Dedicated local port so an existing Zabbix agent on 10050 keeps working.
    $lines.Add('ListenPort=31050')
    $lines.Add('TLSConnect=psk')
    $lines.Add('TLSAccept=psk')
    $lines.Add("TLSPSKIdentity=$($reg.pskIdentity)")
    $lines.Add("TLSPSKFile=$PskFile")
    $lines.Add('# <<< OpsDesk')
    [IO.File]::WriteAllLines($ConfFile, $lines, (New-Object Text.UTF8Encoding($false)))

    Write-Step 'Starting the agent and checking the connection'
    $before = if (Test-Path $AgentLog) { (Get-Content $AgentLog).Count } else { 0 }
    Set-Service -Name $ServiceName -StartupType Automatic
    Restart-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 3
    if ((Get-Service -Name $ServiceName).Status -ne 'Running') { Fail "The '$ServiceName' service did not start; see $AgentLog" }
    $problem = $null
    for ($i = 0; $i -lt 5 -and -not $problem; $i++) {
      Start-Sleep -Seconds 3
      if (Test-Path $AgentLog) {
        $problem = Get-Content $AgentLog | Select-Object -Skip $before |
          Where-Object { $_ -match 'started to fail|cannot connect|connection refused|handshake|psk' } | Select-Object -Last 1
      }
    }
    if ($problem) {
      Write-Host "WARNING: the agent is running but reports a connection problem:" -ForegroundColor Yellow
      Write-Host "  $problem" -ForegroundColor Yellow
      Write-Host "Check outbound TCP to $($reg.serverActive), then run the installer again." -ForegroundColor Yellow
      return
    }
    Write-Host ''
    Write-Host "Done. $($reg.hostName) is now monitored by JSAN (site $SiteCode)." -ForegroundColor Green
    Write-Host 'It appears in OpsDesk within about a minute. Run the same command again any time to repair it.'
  } catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    try { Stop-Transcript | Out-Null } catch { }
  }
}
