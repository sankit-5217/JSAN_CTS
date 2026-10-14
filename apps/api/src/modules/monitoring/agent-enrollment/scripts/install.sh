#!/usr/bin/env bash
# JSAN OpsDesk - monitoring agent installer for Linux
# Site: __OPSDESK_SITE__
#
#   curl -fsSL __OPSDESK_API__/enroll/<code>/install.sh | sudo bash
#
# Options (put them after "bash -s --"):
#   ... | sudo bash -s -- --skip-upgrade   leave the installed OS packages as they are
#   ... | sudo bash -s -- --name WEB01     enroll this machine under another name
#   ... | sudo bash -s -- --uninstall      remove the agent and its configuration
#
# What it does, unattended (no questions asked):
#   1. checks the OS and that OpsDesk and the JSAN Zabbix server are reachable
#   2. updates the OS packages (apt-get update + upgrade, or dnf upgrade);
#      existing configuration files are kept and the machine is never rebooted
#   3. installs Zabbix agent 2 __OPSDESK_ZBX_SERIES__ from repo.zabbix.com
#   4. registers this machine with OpsDesk (site __OPSDESK_SITE__)
#   5. connects the agent OUT to the JSAN Zabbix server, encrypted (TLS-PSK);
#      the agent only listens on 127.0.0.1, no inbound port is opened
#   6. checks the agent is running and connected
# Safe to run again: it updates the existing enrollment instead of duplicating it.
# Log: /var/log/opsdesk-agent-install.log

readonly OPSDESK_API="__OPSDESK_API__"
readonly ENROLL_CODE="__OPSDESK_CODE__"
readonly SITE_CODE="__OPSDESK_SITE__"
readonly ZBX_SERIES="__OPSDESK_ZBX_SERIES__"
readonly ZBX_SERVER="__OPSDESK_SERVER__"

readonly LOG=/var/log/opsdesk-agent-install.log
readonly LOCK=/run/opsdesk-agent-install.lock
readonly CONF=/etc/zabbix/zabbix_agent2.conf
readonly CONF_D=/etc/zabbix/zabbix_agent2.d
readonly OPSDESK_CONF="$CONF_D/opsdesk.conf"
readonly PSK_FILE=/etc/zabbix/opsdesk.psk
readonly AGENT_LOG=/var/log/zabbix/zabbix_agent2.log
# Loopback-only port for the agent's (unused) passive listener; not 10050, so a
# Zabbix agent the client already runs is left alone.
readonly LISTEN_PORT=31050

STEP_TOTAL=6
STEP=0
PKG=""
TMP_DIR=""

say() { printf '%s\n' "$*"; }
step() {
  STEP=$((STEP + 1))
  printf '\n[%d/%d] %s\n' "$STEP" "$STEP_TOTAL" "$*"
}
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  printf 'Nothing else was changed after this point. Full log: %s\n' "$LOG" >&2
  exit 1
}
on_error() {
  local code=$? line=$1
  printf '\nERROR: the installer stopped unexpectedly (line %s, exit code %s).\n' "$line" "$code" >&2
  printf 'Full log: %s - send it to JSAN support if you need help.\n' "$LOG" >&2
  exit "$code"
}
cleanup() { if [ -n "$TMP_DIR" ]; then rm -rf "$TMP_DIR"; fi; }

usage() {
  cat <<EOF
JSAN OpsDesk monitoring agent installer (site $SITE_CODE)

  curl -fsSL $OPSDESK_API/enroll/<code>/install.sh | sudo bash
  ... | sudo bash -s -- --skip-upgrade   leave the installed OS packages as they are
  ... | sudo bash -s -- --name WEB01     enroll this machine under another name
  ... | sudo bash -s -- --uninstall      remove the agent and its configuration
EOF
}

# Minimal JSON string escaping for the values this script sends.
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/ }
  s=${s//$'\r'/}
  s=${s//$'\n'/ }
  printf '%s' "$s"
}

# Value of a "key":"value" string field in a flat JSON object.
json_field() {
  sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" <<<"$2"
}

curl_api() {
  local proto=(--proto '=https' --tlsv1.2)
  case "$OPSDESK_API" in
    http://*) proto=() ;; # local development only
    *) ;;
  esac
  curl -sS "${proto[@]}" --connect-timeout 15 --max-time 60 --retry 3 --retry-delay 3 "$@"
}

apt_get() {
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 \
    apt-get -y -q -o DPkg::Lock::Timeout=600 \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

pkg_mgr() {
  if [ "$PKG" = deb ]; then
    apt_get "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf -y -q "$@"
  else
    yum -y -q "$@"
  fi
}

detect_os() {
  [ -r /etc/os-release ] || die "Cannot read /etc/os-release - unsupported Linux distribution."
  # shellcheck disable=SC1091
  . /etc/os-release
  local arch major id=${ID:-} ver=${VERSION_ID:-}
  arch=$(uname -m)
  case "$arch" in
    x86_64 | aarch64) ;;
    *) die "Unsupported CPU architecture: $arch (supported: x86_64, aarch64)." ;;
  esac
  major=${ver%%.*}
  case "$id:$ver" in
    ubuntu:20.04 | ubuntu:22.04 | ubuntu:24.04)
      PKG=deb
      REPO_URL="https://repo.zabbix.com/zabbix/$ZBX_SERIES/ubuntu/pool/main/z/zabbix-release/zabbix-release_latest_${ZBX_SERIES}+ubuntu${ver}_all.deb"
      ;;
    debian:11 | debian:12)
      PKG=deb
      REPO_URL="https://repo.zabbix.com/zabbix/$ZBX_SERIES/debian/pool/main/z/zabbix-release/zabbix-release_latest_${ZBX_SERIES}+debian${ver}_all.deb"
      ;;
    rhel:8* | rhel:9* | rocky:8* | rocky:9* | almalinux:8* | almalinux:9* | ol:8* | ol:9* | centos:9*)
      PKG=rpm
      REPO_URL="https://repo.zabbix.com/zabbix/$ZBX_SERIES/rhel/$major/$arch/zabbix-release-latest-${ZBX_SERIES}.el${major}.noarch.rpm"
      ;;
    *)
      die "Unsupported OS: ${PRETTY_NAME:-$id $ver}.
Supported: Ubuntu 20.04/22.04/24.04, Debian 11/12, RHEL/Rocky/AlmaLinux/Oracle Linux 8/9."
      ;;
  esac
  OS_PRETTY=${PRETTY_NAME:-$id $ver}
}

check_network() {
  # shellcheck disable=SC2310 # curl_api is one curl call; its failure is handled right here
  curl_api -o /dev/null -f "$OPSDESK_API/health/live" ||
    die "Cannot reach OpsDesk at $OPSDESK_API over HTTPS. Allow outbound HTTPS (443) from this machine."
  local host=${ZBX_SERVER%:*} port=${ZBX_SERVER##*:}
  timeout 10 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null ||
    die "Cannot reach the JSAN Zabbix server at $ZBX_SERVER. Allow outbound TCP $port from this machine (no inbound port is needed)."
}

upgrade_os() {
  if [ "$PKG" = deb ]; then
    apt_get update
    apt_get upgrade
  else
    pkg_mgr upgrade
  fi
  if [ -f /var/run/reboot-required ]; then
    warn "The OS update asks for a reboot. Nothing was rebooted - plan one when convenient."
  fi
}

install_agent() {
  TMP_DIR=$(mktemp -d)
  if [ "$PKG" = deb ]; then
    local have
    have=$(dpkg-query -W -f='${Version}' zabbix-release 2>/dev/null || true)
    case "$have" in
      *"$ZBX_SERIES"*) ;;
      *)
        curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP_DIR/zabbix-release.deb" "$REPO_URL" ||
          die "Could not download the Zabbix repository package from $REPO_URL (outbound HTTPS needed)."
        DEBIAN_FRONTEND=noninteractive dpkg -i "$TMP_DIR/zabbix-release.deb" >/dev/null
        ;;
    esac
    apt_get update
    apt_get install zabbix-agent2
  else
    # EPEL ships older Zabbix packages that would shadow the official ones.
    if [ -f /etc/yum.repos.d/epel.repo ] && ! grep -q '^excludepkgs=zabbix\*' /etc/yum.repos.d/epel.repo; then
      sed -i '/^\[epel\]/a excludepkgs=zabbix*' /etc/yum.repos.d/epel.repo
    fi
    if ! rpm -q zabbix-release >/dev/null 2>&1 || ! rpm -q zabbix-release | grep -q "$ZBX_SERIES"; then
      rpm -Uvh --quiet "$REPO_URL" ||
        die "Could not install the Zabbix repository package from $REPO_URL (outbound HTTPS needed)."
      pkg_mgr clean all >/dev/null
    fi
    pkg_mgr install zabbix-agent2
  fi
  command -v zabbix_agent2 >/dev/null 2>&1 || die "zabbix-agent2 did not install correctly."
}

register_machine() {
  local name machine_hash address body resp http
  name=${NAME_OVERRIDE:-$(hostname -s 2>/dev/null || hostname)}
  [ -n "$name" ] || die "Cannot work out this machine's name; pass --name <NAME>."
  if [ -r /etc/machine-id ] && [ -s /etc/machine-id ]; then
    machine_hash=$(sha256sum /etc/machine-id | cut -c1-32)
  else
    machine_hash=$(printf '%s' "$name" | sha256sum | cut -c1-32)
  fi
  address=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1)
  body=$(printf '{"hostname":"%s","os":"linux","osVersion":"%s","machineId":"%s","address":"%s"}' \
    "$(json_escape "$name")" "$(json_escape "$OS_PRETTY")" "$machine_hash" "$(json_escape "${address:-}")")
  # shellcheck disable=SC2310 # curl_api is one curl call; its failure is handled right here
  resp=$(curl_api -w $'\n%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data-binary @- "$OPSDESK_API/enroll/$ENROLL_CODE/register" <<<"$body") ||
    die "Could not contact OpsDesk to register this machine."
  http=${resp##*$'\n'}
  resp=${resp%$'\n'*}
  if [ "$http" != 200 ]; then
    local msg
    msg=$(json_field message "$resp")
    die "OpsDesk refused the registration (HTTP $http): ${msg:-$resp}"
  fi
  HOST_NAME=$(json_field hostName "$resp")
  SERVER_ACTIVE=$(json_field serverActive "$resp")
  PSK_IDENTITY=$(json_field pskIdentity "$resp")
  PSK=$(json_field psk "$resp")
  if [ -z "$HOST_NAME" ] || [ -z "$SERVER_ACTIVE" ] || [ -z "$PSK_IDENTITY" ] || [ -z "$PSK" ]; then
    die "OpsDesk answered, but the registration details were incomplete."
  fi
}

configure_agent() {
  install -d -m 0755 "$CONF_D"
  # The key is readable by the agent only.
  install -m 0600 -o zabbix -g zabbix /dev/null "$PSK_FILE"
  printf '%s\n' "$PSK" >"$PSK_FILE"
  # Settings this installer owns live in opsdesk.conf; switch off the same
  # keys in the stock file so there is exactly one value for each.
  sed -i -E 's/^(Server|ServerActive|Hostname|HostnameItem|ListenIP|ListenPort|TLSConnect|TLSAccept|TLSPSKIdentity|TLSPSKFile)=/# opsdesk: &/' "$CONF"
  grep -q "^Include=$CONF_D/\*.conf" "$CONF" || printf '\nInclude=%s/*.conf\n' "$CONF_D" >>"$CONF"
  umask 022
  cat >"$OPSDESK_CONF" <<EOF
# Managed by the JSAN OpsDesk agent installer (site $SITE_CODE). Re-run the
# installer to change it; manual edits are overwritten.
Hostname=$HOST_NAME
ServerActive=$SERVER_ACTIVE
# Passive checks only from this machine itself: no port is reachable from
# outside. A dedicated local port, so an existing Zabbix agent on 10050 keeps working.
Server=127.0.0.1
ListenIP=127.0.0.1
ListenPort=$LISTEN_PORT
TLSConnect=psk
TLSAccept=psk
TLSPSKIdentity=$PSK_IDENTITY
TLSPSKFile=$PSK_FILE
EOF
  zabbix_agent2 -c "$CONF" -T >/dev/null 2>&1 || die "The agent rejected its configuration ($CONF)."
}

start_and_verify() {
  local before=0
  CONNECTION_PROBLEM=""
  [ -f "$AGENT_LOG" ] && before=$(wc -l <"$AGENT_LOG")
  systemctl enable --quiet zabbix-agent2
  systemctl restart zabbix-agent2
  sleep 3
  systemctl is-active --quiet zabbix-agent2 ||
    die "The agent did not start. See: journalctl -u zabbix-agent2 -n 50"
  # Watch only what the agent logged since this restart (about 15 seconds).
  for _ in 1 2 3 4 5; do
    sleep 3
    CONNECTION_PROBLEM=$(tail -n +"$((before + 1))" "$AGENT_LOG" 2>/dev/null |
      grep -iE 'started to fail|cannot connect|connection refused|handshake|psk' | tail -n1 || true)
    [ -n "$CONNECTION_PROBLEM" ] && break
  done
  return 0
}

uninstall_agent() {
  step "Removing the OpsDesk monitoring agent"
  systemctl disable --now zabbix-agent2 2>/dev/null || true
  # shellcheck disable=SC2310 # removing an agent that is not installed is fine
  if [ "$PKG" = deb ]; then apt_get purge zabbix-agent2 || true; else pkg_mgr remove zabbix-agent2 || true; fi
  rm -f "$OPSDESK_CONF" "$PSK_FILE"
  say "Done. The agent is removed from this machine."
  say "JSAN still lists the machine until an admin removes it in OpsDesk / Zabbix."
}

main() {
  set -Eeuo pipefail
  trap 'on_error $LINENO' ERR
  trap cleanup EXIT

  [ "$(id -u)" -eq 0 ] || {
    printf 'ERROR: run this as root, e.g.:  curl -fsSL %s/enroll/<code>/install.sh | sudo bash\n' "$OPSDESK_API" >&2
    exit 1
  }

  local skip_upgrade=0 uninstall=0
  NAME_OVERRIDE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --skip-upgrade) skip_upgrade=1 ;;
      --uninstall) uninstall=1 ;;
      --name)
        shift
        NAME_OVERRIDE=${1:-}
        ;;
      --name=*) NAME_OVERRIDE=${1#--name=} ;;
      -h | --help)
        usage
        return 0
        ;;
      *) die "Unknown option: $1 (options: --skip-upgrade, --name <NAME>, --uninstall)" ;;
    esac
    shift
  done
  if [ -n "$NAME_OVERRIDE" ] && ! [[ "$NAME_OVERRIDE" =~ ^[A-Za-z0-9._-]{1,60}$ ]]; then
    die "--name may only use letters, digits, '.', '_' and '-' (max 60 characters)."
  fi

  exec 9>"$LOCK"
  flock -n 9 || die "Another run of this installer is in progress."
  touch "$LOG" && chmod 0600 "$LOG"
  exec > >(tee -a "$LOG") 2>&1
  say "JSAN OpsDesk monitoring agent installer - site $SITE_CODE - $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  detect_os
  if [ "$uninstall" -eq 1 ]; then
    STEP_TOTAL=1
    uninstall_agent
    return 0
  fi

  step "Checking this machine and the network"
  say "  $OS_PRETTY ($(uname -m))"
  check_network
  say "  OpsDesk and the JSAN Zabbix server are reachable"

  if [ "$skip_upgrade" -eq 1 ]; then
    step "Updating the operating system - skipped (--skip-upgrade)"
  else
    step "Updating the operating system (unattended, no reboot)"
    upgrade_os
  fi

  step "Installing Zabbix agent 2 ($ZBX_SERIES)"
  install_agent

  step "Registering this machine with OpsDesk"
  register_machine
  say "  Enrolled as $HOST_NAME"

  step "Configuring the agent (encrypted, outbound only)"
  configure_agent

  step "Starting the agent and checking the connection"
  start_and_verify
  if [ -n "$CONNECTION_PROBLEM" ]; then
    warn "The agent is running but reports a connection problem:"
    warn "  $CONNECTION_PROBLEM"
    warn "Check outbound TCP to $SERVER_ACTIVE, then re-run this installer."
    exit 2
  fi
  say ""
  say "Done. $HOST_NAME is now monitored by JSAN (site $SITE_CODE)."
  say "It appears in OpsDesk within about a minute. Re-run this command any time to repair it."
}

main "$@"
