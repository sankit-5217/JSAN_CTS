#!/bin/bash
# Fault control for the client site lab (run as root in WSL; setup-wsl.sh
# installs it as /usr/local/bin/opsdesk-lab). Every fault is a real change the
# Zabbix proxy observes on its next poll — nothing is injected into Zabbix or
# OpsDesk directly.
set -uo pipefail

FW=127.0.0.21:1161
SW=127.0.0.22:1161
UPS=127.0.0.23:1161
ISP=127.0.0.30
U=1.3.6.1.2.1.33.1
FG=1.3.6.1.4.1.12356.101

set_() { snmpset -v2c -c public -Oqv "$@" >/dev/null || echo "  ! snmpset failed for $*"; }
get_() { snmpget -v2c -c public -Oqv -t 2 -r 0 "$@" 2>/dev/null | tr '\n' ' '; }

usage() {
  cat <<'EOF'
opsdesk-lab <command>

  status                 show services and current device readings
  ups-on-battery         mains failure: UPS runs on battery          (Zabbix High     -> OpsDesk HIGH alert)
  ups-battery-low        battery nearly flat, 4 min runtime left     (Zabbix Disaster -> OpsDesk CRITICAL + auto incident)
  ups-overload           UPS load 92%  (trigger after 2 min)         (Zabbix Warning)
  ups-normal             mains back, battery full, normal load
  wan-down | wan-up      firewall wan1 (ISP-A) link down / up        (Zabbix Average  -> OpsDesk HIGH alert)
  isp-down | isp-up      ISP gateway stops answering ping (~3 min)   (Zabbix High     -> OpsDesk HIGH alert)
  fw-cpu-high | fw-cpu-normal   firewall CPU 97% (after 5 min)       (Zabbix Warning)
  port-down N | port-up N       switch port Gi1/0/N link             (Zabbix Average)
  offline fw|sw|ups | online fw|sw|ups   stop / start a device's SNMP agent
  reset                  everything back to normal
EOF
}

unit_for() {
  case "$1" in
    fw) echo opsdesk-snmpsim@SITE02-FW-001 ;;
    sw) echo opsdesk-snmpsim@SITE02-SW-001 ;;
    ups) echo opsdesk-snmpsim@SITE02-UPS-001 ;;
    *) echo "unknown device '$1' (use fw, sw or ups)" >&2; exit 2 ;;
  esac
}

ups_normal() {
  set_ $UPS $U.4.1.0 i 3 $U.2.1.0 i 2 $U.2.2.0 i 0 $U.2.3.0 i 47 $U.2.4.0 i 100 $U.3.3.1.3.1 i 231 $U.4.4.1.5.1 i 38
}

cmd=${1:-status}
case "$cmd" in
  status)
    echo "services:"
    for s in zabbix-proxy opsdesk-site02-agent opsdesk-snmpsim@SITE02-FW-001 opsdesk-snmpsim@SITE02-SW-001 opsdesk-snmpsim@SITE02-UPS-001; do
      printf "  %-34s %s\n" "$s" "$(systemctl is-active "$s")"
    done
    echo "UPS     source(3=mains,5=battery) battery(2=ok,3=low) runtime-min charge% load% input-V:"
    echo "        $(get_ $UPS $U.4.1.0 $U.2.1.0 $U.2.3.0 $U.2.4.0 $U.4.4.1.5.1 $U.3.3.1.3.1)"
    echo "FW      cpu% mem% sessions wan1-oper(1=up,2=down) wan2-oper: $(get_ $FW $FG.4.1.3.0 $FG.4.1.4.0 $FG.4.1.8.0 1.3.6.1.2.1.2.2.1.8.1 1.3.6.1.2.1.2.2.1.8.2)"
    echo "SW      port oper status 1..8: $(get_ $SW $(for i in 1 2 3 4 5 6 7 8; do printf '1.3.6.1.2.1.2.2.1.8.%s ' $i; done))"
    if iptables -C INPUT -d $ISP -p icmp -j DROP 2>/dev/null; then echo "ISP     gateway $ISP: DOWN (pings dropped)"; else echo "ISP     gateway $ISP: up"; fi
    ;;
  ups-on-battery) set_ $UPS $U.3.3.1.3.1 i 0 $U.2.2.0 i 180 $U.2.3.0 i 31 $U.2.4.0 i 83 $U.4.1.0 i 5; echo "UPS on battery." ;;
  ups-battery-low) set_ $UPS $U.3.3.1.3.1 i 0 $U.4.1.0 i 5 $U.2.2.0 i 1980 $U.2.3.0 i 4 $U.2.4.0 i 9 $U.2.1.0 i 3; echo "UPS battery low, 4 min left." ;;
  ups-overload) set_ $UPS $U.4.4.1.5.1 i 92; echo "UPS load 92%." ;;
  ups-normal) ups_normal; echo "UPS back to normal." ;;
  wan-down) set_ $FW 1.3.6.1.2.1.2.2.1.8.1 i 2; echo "Firewall wan1 down." ;;
  wan-up) set_ $FW 1.3.6.1.2.1.2.2.1.8.1 i 1; echo "Firewall wan1 up." ;;
  isp-down) iptables -C INPUT -d $ISP -p icmp -j DROP 2>/dev/null || iptables -I INPUT -d $ISP -p icmp -j DROP; echo "ISP gateway stops answering ping." ;;
  isp-up) while iptables -D INPUT -d $ISP -p icmp -j DROP 2>/dev/null; do :; done; echo "ISP gateway answers ping." ;;
  fw-cpu-high) set_ $FW $FG.4.1.3.0 u 97; echo "Firewall CPU 97%." ;;
  fw-cpu-normal) set_ $FW $FG.4.1.3.0 u 14; echo "Firewall CPU 14%." ;;
  port-down|port-up)
    n=${2:?port number 1-8}
    set_ $SW 1.3.6.1.2.1.2.2.1.8.$n i $([ "$cmd" = port-down ] && echo 2 || echo 1)
    echo "Switch port Gi1/0/$n ${cmd#port-}." ;;
  offline) systemctl stop "$(unit_for "${2:-}")"; echo "Stopped ${2}." ;;
  online) systemctl start "$(unit_for "${2:-}")"; echo "Started ${2}." ;;
  reset)
    for d in fw sw ups; do systemctl start "$(unit_for $d)"; done
    sleep 2
    ups_normal
    set_ $FW 1.3.6.1.2.1.2.2.1.8.1 i 1 $FG.4.1.3.0 u 14
    for i in 1 2 3 4 5 6 8; do set_ $SW 1.3.6.1.2.1.2.2.1.8.$i i 1; done
    while iptables -D INPUT -d $ISP -p icmp -j DROP 2>/dev/null; do :; done
    echo "Everything back to normal." ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
