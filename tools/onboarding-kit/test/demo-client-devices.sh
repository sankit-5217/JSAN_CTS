#!/bin/bash
# TEST ONLY. Runs pretend client equipment inside the client test machine so
# the onboarding kit can be exercised end to end without real hardware:
#   127.0.0.51:1161  SITE03-UPS-001  UPS-MIB, SNMPv3 authPriv (SHA256/AES128, context "public")
#   127.0.0.52:1161  SITE03-SW-001   switch, SNMP v2c community "site03-ro"
#   127.0.0.53       SITE03-ISP-001  ISP gateway (ping; demo-fault.sh isp-down drops it)
# Usage (as root in the client machine): bash demo-client-devices.sh <path to tools/client-site-lab/snmprec>
set -euo pipefail
SRC=${1:?path to tools/client-site-lab/snmprec}
OPT=/opt/jsan-demo-devices
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq python3-venv snmp iptables >/dev/null
id jsandemo >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin jsandemo
if [ ! -x "$OPT/venv/bin/snmpsim-command-responder" ]; then
  mkdir -p "$OPT"
  python3 -m venv "$OPT/venv"
  "$OPT/venv/bin/pip" install -q --upgrade pip
  "$OPT/venv/bin/pip" install -q "snmpsim==1.1.7"
fi
VAR="$OPT/venv/lib/python3.12/site-packages/snmpsim/variation"

mkdir -p "$OPT/devices/ups" "$OPT/devices/sw"
sed 's/SITE02/SITE03/g' "$SRC/SITE02-UPS-001.snmprec" > "$OPT/devices/ups/public.snmprec"
sed 's/SITE02/SITE03/g' "$SRC/SITE02-SW-001.snmprec" > "$OPT/devices/sw/site03-ro.snmprec"
cat > "$OPT/devices/ups/args" <<EOF
ARGS=--agent-udpv4-endpoint=127.0.0.51:1161 --v3-user=site03-monitor --v3-auth-key=Demo-Auth-Key-2026 --v3-auth-proto=SHA256 --v3-priv-key=Demo-Priv-Key-2026 --v3-priv-proto=AES128
EOF
cat > "$OPT/devices/sw/args" <<EOF
ARGS=--agent-udpv4-endpoint=127.0.0.52:1161
EOF
rm -rf "$OPT/cache"; mkdir -p "$OPT/cache"
chown -R jsandemo:jsandemo "$OPT/devices" "$OPT/cache"

cat > /etc/systemd/system/jsan-demo-device@.service <<UNIT
[Unit]
Description=JSAN onboarding test: simulated client device %i
After=network.target
[Service]
User=jsandemo
EnvironmentFile=$OPT/devices/%i/args
ExecStart=/bin/sh -c 'exec $OPT/venv/bin/snmpsim-command-responder --data-dir=$OPT/devices/%i --cache-dir=$OPT/cache/%i --variation-modules-dir=$VAR \$ARGS'
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
for d in ups sw; do systemctl enable -q "jsan-demo-device@$d"; systemctl restart "jsan-demo-device@$d"; done
sleep 5
echo "UPS (v3):  $(snmpget -v3 -l authPriv -u site03-monitor -a SHA-256 -A Demo-Auth-Key-2026 -x AES -X Demo-Priv-Key-2026 -n public -Oqv 127.0.0.51:1161 1.3.6.1.2.1.1.5.0 2>&1)"
echo "SW (v2c):  $(snmpget -v2c -c site03-ro -Oqv 127.0.0.52:1161 1.3.6.1.2.1.1.5.0 2>&1)"
echo "ISP ping:  $(ping -c1 -W1 127.0.0.53 >/dev/null && echo answers || echo no answer)"
