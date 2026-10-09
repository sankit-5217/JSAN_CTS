#!/bin/bash
# JSAN OpsDesk monitoring — client-side installer for the Zabbix proxy.
#
#   sudo bash install-proxy.sh proxy.env
#
# Installs Zabbix proxy 7.0 (active mode, PSK-encrypted) on this VM, points it
# at the JSAN Zabbix server, and (optionally) a local agent that monitors this
# VM itself. The proxy only connects OUT; nothing listens on the network
# except the proxy's port for agents on your LAN. Safe to run again.
#
# Supported: Ubuntu 22.04, Ubuntu 24.04, Debian 12.
set -euo pipefail

ENV_FILE=${1:-proxy.env}
ZBX_VERSION=7.0
CONF=/etc/zabbix/zabbix_proxy.conf
PSK_FILE=/etc/zabbix/zabbix_proxy.psk
DB=/var/lib/zabbix/zabbix_proxy.db
LOG=/var/log/zabbix/zabbix_proxy.log

say()  { printf '\n== %s\n' "$*"; }
ok()   { printf '   OK  %s\n' "$*"; }
die()  { printf '\n   FAILED  %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash $0 $ENV_FILE"
[ -r "$ENV_FILE" ] || die "Settings file '$ENV_FILE' not found (it comes from JSAN with this script)"

# ---------------------------------------------------------------- settings
say "Reading settings from $ENV_FILE"
# Parse KEY=VALUE lines only — the file is never executed.
declare -A S
while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]] || die "Unexpected line in $ENV_FILE: $line"
  S[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
done < "$ENV_FILE"
for k in ZBX_SERVER ZBX_SERVER_PORT PROXY_NAME PSK_IDENTITY PSK PROXY_LISTEN_PORT; do
  [ -n "${S[$k]:-}" ] || die "$k is missing from $ENV_FILE"
done
[[ "${S[PSK]}" =~ ^[0-9a-f]{64}$ ]] || die "PSK in $ENV_FILE is not 64 hex characters — ask JSAN for a fresh bundle"
[[ "${S[ZBX_SERVER_PORT]}" =~ ^[0-9]+$ && "${S[PROXY_LISTEN_PORT]}" =~ ^[0-9]+$ ]] || die "Ports must be numbers"
[[ "${S[PROXY_NAME]}" =~ ^[A-Z0-9-]+$ ]] || die "PROXY_NAME looks wrong: ${S[PROXY_NAME]}"
INSTALL_AGENT=${S[INSTALL_AGENT]:-no}
ok "proxy ${S[PROXY_NAME]} -> ${S[ZBX_SERVER]}:${S[ZBX_SERVER_PORT]}"

# ---------------------------------------------------------------- OS
say "Checking this machine"
. /etc/os-release
case "$ID:$VERSION_ID" in
  ubuntu:22.04) REPO_OS=ubuntu; REPO_TAG=ubuntu22.04 ;;
  ubuntu:24.04) REPO_OS=ubuntu; REPO_TAG=ubuntu24.04 ;;
  debian:12)    REPO_OS=debian; REPO_TAG=debian12 ;;
  *) die "Unsupported OS: $PRETTY_NAME (use Ubuntu 22.04/24.04 or Debian 12)" ;;
esac
ok "$PRETTY_NAME"
[ "$(ps -p 1 -o comm=)" = "systemd" ] || die "systemd is not running (on WSL, set [boot] systemd=true in /etc/wsl.conf and restart)"
if dpkg -s zabbix-server-mysql >/dev/null 2>&1 || dpkg -s zabbix-server-pgsql >/dev/null 2>&1; then
  die "A Zabbix SERVER is installed on this machine. The proxy must run on its own VM."
fi

# ---------------------------------------------------------------- network
say "Checking the connection to JSAN"
if ! getent hosts "${S[ZBX_SERVER]}" >/dev/null; then
  die "Cannot resolve ${S[ZBX_SERVER]} — check DNS on this VM"
fi
ok "${S[ZBX_SERVER]} resolves to $(getent hosts "${S[ZBX_SERVER]}" | awk '{print $1; exit}')"
if ! timeout 6 bash -c "exec 3<>/dev/tcp/${S[ZBX_SERVER]}/${S[ZBX_SERVER_PORT]}" 2>/dev/null; then
  die "Cannot reach ${S[ZBX_SERVER]} on TCP ${S[ZBX_SERVER_PORT]}. Allow outbound TCP ${S[ZBX_SERVER_PORT]} from this VM in your firewall, then run again."
fi
ok "TCP ${S[ZBX_SERVER_PORT]} to ${S[ZBX_SERVER]} is open"
holder=$(ss -Hltnp "sport = :${S[PROXY_LISTEN_PORT]}" 2>/dev/null | grep -v zabbix_proxy || true)
[ -z "$holder" ] || die "Port ${S[PROXY_LISTEN_PORT]} is already used on this VM: $holder"

# ---------------------------------------------------------------- packages
say "Installing Zabbix proxy $ZBX_VERSION"
export DEBIAN_FRONTEND=noninteractive
current_release=$(dpkg-query -W -f='${Version}' zabbix-release 2>/dev/null || true)
if [ -n "$current_release" ] && [[ "$current_release" != *"$ZBX_VERSION"* ]]; then
  die "Another Zabbix repository ($current_release) is configured. Remove it first: apt-get purge zabbix-release"
fi
if [ -z "$current_release" ]; then
  tmp=$(mktemp -d)
  url="https://repo.zabbix.com/zabbix/$ZBX_VERSION/$REPO_OS/pool/main/z/zabbix-release/zabbix-release_latest_${ZBX_VERSION}+${REPO_TAG}_all.deb"
  curl -fsSL -o "$tmp/zabbix-release.deb" "$url" || die "Could not download the Zabbix repository package from $url (outbound HTTPS needed during install)"
  dpkg -i "$tmp/zabbix-release.deb" >/dev/null
  rm -rf "$tmp"
fi
apt-get update -qq || die "apt-get update failed — check this VM's package mirrors / outbound HTTPS"
pkgs="zabbix-proxy-sqlite3 zabbix-sql-scripts fping snmp sqlite3"
[ "$INSTALL_AGENT" = "yes" ] && pkgs="$pkgs zabbix-agent"
# Stop Debian from starting the services with their DEFAULT config during
# install (the default agent listens on 10050 and fails if that port is taken).
# They are started below, once configured. policy-rc.d is removed on exit.
if [ ! -e /usr/sbin/policy-rc.d ]; then
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 755 /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
fi
# shellcheck disable=SC2086
if ! apt-get install -y -qq $pkgs > /tmp/jsan-proxy-apt.log 2>&1; then
  tail -n 15 /tmp/jsan-proxy-apt.log >&2
  die "Package installation failed (full log: /tmp/jsan-proxy-apt.log)"
fi
# Finish any package left half-configured by an earlier failed run, while
# service starts are still blocked.
dpkg --configure -a >/dev/null 2>&1 || true
rm -f /usr/sbin/policy-rc.d
trap - EXIT
ok "$(zabbix_proxy -V | head -1)"

# ---------------------------------------------------------------- config
say "Configuring the proxy"
[ -f "$CONF.orig" ] || cp -a "$CONF" "$CONF.orig"
umask 077
printf '%s\n' "${S[PSK]}" > "$PSK_FILE"
chown zabbix:zabbix "$PSK_FILE"; chmod 600 "$PSK_FILE"
umask 022
cat > "$CONF" <<CONFEOF
# Written by the JSAN onboarding kit ($(date -u +%Y-%m-%dT%H:%MZ)). Original: $CONF.orig
ProxyMode=0
Server=${S[ZBX_SERVER]}:${S[ZBX_SERVER_PORT]}
Hostname=${S[PROXY_NAME]}
ListenPort=${S[PROXY_LISTEN_PORT]}
LogFile=$LOG
LogFileSize=20
PidFile=/run/zabbix/zabbix_proxy.pid
SocketDir=/run/zabbix
DBName=$DB
# Keep up to 24 h of data if the link to JSAN is down; it is sent when it returns.
ProxyOfflineBuffer=24
ProxyConfigFrequency=30
DataSenderFrequency=1
StartPollers=5
StartPingers=2
FpingLocation=/usr/bin/fping
Timeout=4
TLSConnect=psk
TLSAccept=psk
TLSPSKIdentity=${S[PSK_IDENTITY]}
TLSPSKFile=$PSK_FILE
CONFEOF
ok "$CONF"

# Build the SQLite database from the shipped schema. Letting the proxy create
# it on first start races with systemd and can leave the service stuck.
mkdir -p /var/lib/zabbix && chown zabbix:zabbix /var/lib/zabbix
if [ ! -s "$DB" ] || ! sqlite3 "$DB" "select mandatory from dbversion" >/dev/null 2>&1; then
  systemctl stop zabbix-proxy 2>/dev/null || true
  rm -f "$DB"
  sqlite3 "$DB" < /usr/share/zabbix-sql-scripts/sqlite3/proxy.sql
  chown zabbix:zabbix "$DB"; chmod 640 "$DB"
  ok "proxy database created"
else
  ok "proxy database already present"
fi

# ---------------------------------------------------------------- start + verify
say "Starting the proxy and waiting for JSAN to answer (up to 2 minutes)"
mark=$( [ -f "$LOG" ] && wc -l < "$LOG" || echo 0 )
systemctl enable -q zabbix-proxy
systemctl restart --no-block zabbix-proxy
result=""
for _ in $(seq 1 60); do
  sleep 2
  newlog=$(tail -n +"$((mark + 1))" "$LOG" 2>/dev/null || true)
  if grep -q "received configuration data from server" <<<"$newlog"; then result=ok; break; fi
  if grep -q -E "cannot establish TLS|SSL_ERROR|PSK" <<<"$newlog"; then result=tls; fi
  if grep -q -E "Unable to connect to .*(Connection refused|timed out)" <<<"$newlog"; then result=net; fi
done
# On any failure, stop the proxy so it does not retry a bad key or address forever.
[ "$result" = ok ] || systemctl stop zabbix-proxy 2>/dev/null || true
case "$result" in
  ok)  ok "connected to JSAN and received its monitoring configuration" ;;
  tls) die "JSAN refused the encrypted connection. Either the key in $ENV_FILE is outdated or JSAN has not registered ${S[PROXY_NAME]} yet. Send JSAN this message; do not retry in a loop." ;;
  net) die "The proxy cannot reach ${S[ZBX_SERVER]}:${S[ZBX_SERVER_PORT]}. Check the outbound firewall rule." ;;
  *)   die "No answer from JSAN within 2 minutes. Last log lines:
$(tail -n 8 "$LOG" 2>/dev/null)" ;;
esac

# ---------------------------------------------------------------- local agent
if [ "$INSTALL_AGENT" = "yes" ]; then
  say "Configuring the agent that monitors this VM"
  AGENT_CONF=/etc/zabbix/zabbix_agentd.conf
  [ -f "$AGENT_CONF.orig" ] || cp -a "$AGENT_CONF" "$AGENT_CONF.orig"
  cat > "$AGENT_CONF" <<AGENTEOF
# Written by the JSAN onboarding kit. Original: $AGENT_CONF.orig
# Active-only: reports to the local proxy, opens no listening port.
Hostname=${S[AGENT_HOSTNAME]:-${S[PROXY_NAME]}-VM}
ServerActive=127.0.0.1:${S[PROXY_LISTEN_PORT]}
StartAgents=0
LogFile=/var/log/zabbix/zabbix_agentd.log
LogFileSize=5
PidFile=/run/zabbix/zabbix_agentd.pid
Include=/etc/zabbix/zabbix_agentd.d/*.conf
AGENTEOF
  systemctl enable -q zabbix-agent
  systemctl restart zabbix-agent
  ok "agent reporting as ${S[AGENT_HOSTNAME]:-${S[PROXY_NAME]}-VM}"
fi

say "Done"
echo "   The proxy is running and connected to JSAN. JSAN will now see your devices."
echo "   The key is stored in $PSK_FILE (readable by Zabbix only)."
echo "   Please delete $ENV_FILE from this machine now."
