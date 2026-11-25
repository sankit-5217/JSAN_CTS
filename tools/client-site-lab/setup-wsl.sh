#!/bin/bash
# Client site lab — Ubuntu (WSL) side. Run as root:
#   wsl -d Ubuntu-24.04 -u root -- bash /mnt/c/.../tools/client-site-lab/setup-wsl.sh
#
# Builds a pretend client office ("SITE02") next to the local Zabbix server:
#   - Zabbix proxy SITE02-PROXY: active mode, PSK-encrypted, connects OUT to the
#     server on 127.0.0.1:10051 (a real client site opens no inbound ports).
#   - Simulated SNMP devices (snmpsim), one per loopback IP, polled by the proxy:
#       127.0.0.21:1161  SITE02-FW-001   FortiGate-style firewall
#       127.0.0.22:1161  SITE02-SW-001   access switch
#       127.0.0.23:1161  SITE02-UPS-001  UPS (RFC 1628 UPS-MIB)
#     127.0.0.30 is the ISP gateway (ICMP only; lab.sh drops pings to it).
#   - A second Zabbix agent, SITE02-SRV-001, active mode, reporting to the proxy.
# Idempotent: safe to re-run. Nothing here listens on a non-loopback address
# except what Zabbix already does.
set -euo pipefail

LAB_DIR="$(cd "$(dirname "$0")" && pwd)"
OPT=/opt/opsdesk-client-lab
ETC=/etc/zabbix/client-lab
LAB_USER=opsdesklab
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get install -y -qq zabbix-proxy-sqlite3 fping snmp python3-venv iptables sqlite3 >/dev/null

echo "== lab user and folders"
id "$LAB_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$LAB_USER"
mkdir -p "$OPT/devices" "$OPT/cache" "$ETC"
chown -R "$LAB_USER:$LAB_USER" "$OPT/cache"

echo "== snmpsim (SNMP device simulator)"
if [ ! -x "$OPT/venv/bin/snmpsim-command-responder" ]; then
  python3 -m venv "$OPT/venv"
  "$OPT/venv/bin/pip" install -q --upgrade pip
  "$OPT/venv/bin/pip" install -q "snmpsim==1.1.7"
fi

# Each device gets its own data dir with a "public" community file.
declare -A DEVICE_IP=( [SITE02-FW-001]=127.0.0.21 [SITE02-SW-001]=127.0.0.22 [SITE02-UPS-001]=127.0.0.23 )
for dev in "${!DEVICE_IP[@]}"; do
  mkdir -p "$OPT/devices/$dev"
  # Only (re)seed the data file when it changed in the repo, so a fault set by
  # lab.sh survives a re-run of this script.
  if ! cmp -s "$LAB_DIR/snmprec/$dev.snmprec" "$OPT/devices/$dev/.source"; then
    cp "$LAB_DIR/snmprec/$dev.snmprec" "$OPT/devices/$dev/public.snmprec"
    cp "$LAB_DIR/snmprec/$dev.snmprec" "$OPT/devices/$dev/.source"
    rm -rf "$OPT/cache/$dev"  # index + writecache state for this device
  fi
  echo "${DEVICE_IP[$dev]}" > "$OPT/devices/$dev/.ip"
done
chown -R "$LAB_USER:$LAB_USER" "$OPT/devices"

cat > /etc/systemd/system/opsdesk-snmpsim@.service <<'UNIT'
[Unit]
Description=OpsDesk client lab simulated SNMP device %i
After=network.target

[Service]
User=opsdesklab
Group=opsdesklab
ExecStart=/bin/sh -c 'exec /opt/opsdesk-client-lab/venv/bin/snmpsim-command-responder --data-dir=/opt/opsdesk-client-lab/devices/%i --cache-dir=/opt/opsdesk-client-lab/cache/%i --variation-modules-dir=/opt/opsdesk-client-lab/venv/lib/python3.12/site-packages/snmpsim/variation --agent-udpv4-endpoint=$(cat /opt/opsdesk-client-lab/devices/%i/.ip):1161'
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

echo "== Zabbix proxy SITE02-PROXY (active, PSK)"
if [ ! -s "$ETC/site02-proxy.psk" ]; then
  openssl rand -hex 32 > "$ETC/site02-proxy.psk"
fi
chown zabbix:zabbix "$ETC/site02-proxy.psk"
chmod 600 "$ETC/site02-proxy.psk"
mkdir -p /var/lib/zabbix && chown zabbix:zabbix /var/lib/zabbix
# Create the proxy's SQLite DB from the shipped schema. Letting the proxy build
# it on first start races with systemd's forking/PIDFile tracking, which then
# stops the proxy halfway ("creating database ... Got signal 15").
PROXY_DB=/var/lib/zabbix/zabbix_proxy_site02.db
if [ ! -s "$PROXY_DB" ] || ! sqlite3 "$PROXY_DB" "select mandatory from dbversion" >/dev/null 2>&1; then
  systemctl stop zabbix-proxy 2>/dev/null || true
  rm -f "$PROXY_DB"
  sqlite3 "$PROXY_DB" < /usr/share/zabbix-sql-scripts/sqlite3/proxy.sql
  chown zabbix:zabbix "$PROXY_DB"
fi

cat > /etc/zabbix/zabbix_proxy.conf <<'CONF'
# OpsDesk client site lab — pretend client office SITE02.
ProxyMode=0
Server=127.0.0.1:10051
Hostname=SITE02-PROXY
# The local Zabbix server already owns 10051.
ListenPort=10061
ListenIP=127.0.0.1
LogFile=/var/log/zabbix/zabbix_proxy.log
LogFileSize=10
PidFile=/run/zabbix/zabbix_proxy.pid
SocketDir=/run/zabbix
DBName=/var/lib/zabbix/zabbix_proxy_site02.db
ProxyConfigFrequency=10
DataSenderFrequency=1
StartPollers=5
StartPingers=2
FpingLocation=/usr/bin/fping
Timeout=4
TLSConnect=psk
TLSAccept=psk
TLSPSKIdentity=SITE02-PROXY
TLSPSKFile=/etc/zabbix/client-lab/site02-proxy.psk
CONF

echo "== client server agent SITE02-SRV-001 (active, to the proxy)"
mkdir -p /run/zabbix-site02 /var/log/zabbix
chown zabbix:zabbix /run/zabbix-site02
cat > "$ETC/zabbix_agentd_site02.conf" <<'CONF'
Hostname=SITE02-SRV-001
Server=127.0.0.1
ServerActive=127.0.0.1:10061
ListenPort=10071
ListenIP=127.0.0.24
PidFile=/run/zabbix-site02/zabbix_agentd.pid
LogFile=/var/log/zabbix/zabbix_agentd_site02.log
LogFileSize=5
RefreshActiveChecks=60
CONF
cat > /etc/systemd/system/opsdesk-site02-agent.service <<'UNIT'
[Unit]
Description=OpsDesk client lab Zabbix agent SITE02-SRV-001
After=network.target zabbix-proxy.service

[Service]
Type=forking
User=zabbix
Group=zabbix
RuntimeDirectory=zabbix-site02
PIDFile=/run/zabbix-site02/zabbix_agentd.pid
ExecStart=/usr/sbin/zabbix_agentd -c /etc/zabbix/client-lab/zabbix_agentd_site02.conf
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

echo "== start everything"
systemctl daemon-reload
systemctl enable -q zabbix-proxy
# A plain restart (no enable --now first): restarting while the proxy is still
# creating its SQLite database on first start leaves it stuck stopping.
systemctl restart --no-block zabbix-proxy
for dev in "${!DEVICE_IP[@]}"; do
  systemctl enable -q "opsdesk-snmpsim@$dev"
  systemctl restart --no-block "opsdesk-snmpsim@$dev"
done
systemctl enable -q opsdesk-site02-agent
systemctl restart --no-block opsdesk-site02-agent

install -m 755 "$LAB_DIR/lab.sh" /usr/local/bin/opsdesk-lab
sleep 8
echo "== status"
systemctl is-active zabbix-proxy opsdesk-site02-agent "opsdesk-snmpsim@SITE02-FW-001" "opsdesk-snmpsim@SITE02-SW-001" "opsdesk-snmpsim@SITE02-UPS-001"
echo "PSK identity: SITE02-PROXY (key in $ETC/site02-proxy.psk)"
