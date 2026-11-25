# Windows shortcut for the client site lab fault controls (runs lab.sh in WSL).
#   powershell -File tools\client-site-lab\lab.ps1 status
#   powershell -File tools\client-site-lab\lab.ps1 ups-on-battery
#   powershell -File tools\client-site-lab\lab.ps1 port-down 4
param(
  [Parameter(Position = 0)][string]$Command = "status",
  [Parameter(Position = 1)][string]$Arg = ""
)
$distro = if ($env:WSL_DISTRO) { $env:WSL_DISTRO } else { "Ubuntu-24.04" }
if ($Arg) {
  wsl -d $distro -u root -- opsdesk-lab $Command $Arg
} else {
  wsl -d $distro -u root -- opsdesk-lab $Command
}
