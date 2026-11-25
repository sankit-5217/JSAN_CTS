#!/bin/bash
# TEST ONLY: break / repair the pretend SITE03 equipment (run as root in the client machine).
#   demo-fault.sh ups-on-battery | ups-battery-low | ups-normal | isp-down | isp-up | port-down N | port-up N
set -uo pipefail
U=1.3.6.1.2.1.33.1
V3=(-v3 -l authPriv -u site03-monitor -a SHA-256 -A Demo-Auth-Key-2026 -x AES -X Demo-Priv-Key-2026 -n public)
ups() { snmpset "${V3[@]}" -Oqv 127.0.0.51:1161 "$@" >/dev/null || echo "snmpset failed"; }
case "${1:-}" in
  ups-on-battery) ups $U.3.3.1.3.1 i 0 $U.2.2.0 i 180 $U.2.3.0 i 31 $U.2.4.0 i 83 $U.4.1.0 i 5; echo "UPS on battery" ;;
  ups-battery-low) ups $U.3.3.1.3.1 i 0 $U.4.1.0 i 5 $U.2.2.0 i 1980 $U.2.3.0 i 4 $U.2.4.0 i 9 $U.2.1.0 i 3; echo "UPS battery low" ;;
  ups-normal) ups $U.4.1.0 i 3 $U.2.1.0 i 2 $U.2.2.0 i 0 $U.2.3.0 i 47 $U.2.4.0 i 100 $U.3.3.1.3.1 i 231; echo "UPS normal" ;;
  isp-down) iptables -C INPUT -d 127.0.0.53 -p icmp -j DROP 2>/dev/null || iptables -I INPUT -d 127.0.0.53 -p icmp -j DROP; echo "ISP down" ;;
  isp-up) while iptables -D INPUT -d 127.0.0.53 -p icmp -j DROP 2>/dev/null; do :; done; echo "ISP up" ;;
  port-down|port-up) snmpset -v2c -c site03-ro -Oqv 127.0.0.52:1161 1.3.6.1.2.1.2.2.1.8.${2:?port} i "$([ "$1" = port-down ] && echo 2 || echo 1)" >/dev/null; echo "$1 $2" ;;
  *) echo "usage: $0 ups-on-battery|ups-battery-low|ups-normal|isp-down|isp-up|port-down N|port-up N"; exit 2 ;;
esac
