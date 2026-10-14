import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderTemplate } from "./agent-enrollment.service";

/**
 * The installer quality rubric (docs/runbooks/agent-installer.md) as tests:
 * every rule that can be checked without a real client machine is checked
 * here, on the scripts exactly as they are served.
 */

const VALUES = {
  __OPSDESK_API__: "https://api.example.com/api/v1",
  __OPSDESK_CODE__: "A".repeat(43),
  __OPSDESK_SITE__: "SITE04",
  __OPSDESK_ZBX_VERSION__: "7.0.31",
  __OPSDESK_ZBX_SERIES__: "7.0",
  __OPSDESK_SERVER__: "zbx.example.com:12762",
};

const raw = (f: string) => readFileSync(join(__dirname, "scripts", f), "utf8");
const sh = renderTemplate(raw("install.sh"), VALUES);
const ps1 = renderTemplate(raw("install.ps1"), VALUES);
/** The script without comment lines, so rules aren't satisfied by documentation. */
const code = (s: string) =>
  s
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

function available(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return !r.error && r.status === 0;
}

describe("installer templates", () => {
  it("fill every placeholder", () => {
    expect(sh).not.toMatch(/__OPSDESK_[A-Z_]+__/);
    expect(ps1).not.toMatch(/__OPSDESK_[A-Z_]+__/);
    expect(sh).toContain('readonly ZBX_SERVER="zbx.example.com:12762"');
    expect(ps1).toContain("$ZbxVersion = '7.0.31'");
  });

  it("R16: refuse values that could break out of the script", () => {
    for (const bad of ['SITE"04', "SITE$(id)", "SITE`x`", "SITE 04", "SITE';x"]) {
      expect(() => renderTemplate(raw("install.sh"), { ...VALUES, __OPSDESK_SITE__: bad })).toThrow(
        /not allowed/,
      );
    }
  });

  it("refuse a template with an unfilled placeholder", () => {
    expect(() => renderTemplate("x __OPSDESK_NEW__", VALUES)).toThrow(/placeholder/);
  });

  it("use LF line endings (a CRLF script breaks bash)", () => {
    expect(raw("install.sh")).not.toContain("\r");
  });
});

describe("Linux installer (install.sh) rubric", () => {
  const body = code(sh);

  it("R1: only functions and assignments before the final main call", () => {
    const lines = sh.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe('main "$@"');
    expect(body.match(/^main "\$@"$/gm)).toHaveLength(1);
  });

  it("R2: strict mode and an ERR trap", () => {
    expect(body).toContain("set -Eeuo pipefail");
    expect(body).toMatch(/trap 'on_error \$LINENO' ERR/);
  });

  it("R3: refuses to run without root and shows the sudo command", () => {
    expect(body).toMatch(/\[ "\$\(id -u\)" -eq 0 \]/);
    expect(body).toContain("| sudo bash");
  });

  it("R4: never prompts", () => {
    expect(body).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(body).toContain("NEEDRESTART_MODE=a");
    expect(body).toContain("--force-confold");
    expect(body).toContain("--force-confdef");
    expect(body).toContain("DPkg::Lock::Timeout");
    expect(body).toMatch(/apt-get -y/);
    expect(body).toMatch(/dnf -y/);
  });

  it("R5: upgrades the OS unless --skip-upgrade, and never reboots", () => {
    expect(body).toContain("apt_get upgrade");
    expect(body).toContain("pkg_mgr upgrade");
    expect(body).toContain("--skip-upgrade");
    // No command that restarts the machine (the reboot-required *check* is fine).
    expect(body).not.toMatch(
      /(^|[;&|]\s*)(sudo\s+)?(reboot|shutdown|poweroff|systemctl\s+(reboot|poweroff))\b/m,
    );
    expect(body).toContain("reboot-required");
  });

  it("R6: supported distributions only", () => {
    for (const os of ["ubuntu:24.04", "debian:12", "rocky:9*", "rhel:8*"]) expect(body).toContain(os);
    expect(body).toContain("Unsupported OS");
  });

  it("R7: checks the network before installing anything", () => {
    expect(body.indexOf("check_network\n")).toBeLessThan(body.indexOf("upgrade_os\n"));
    expect(body).toContain("/health/live");
    expect(body).toContain("/dev/tcp/");
  });

  it("R8: no inbound exposure", () => {
    expect(body).toContain("ListenIP=127.0.0.1");
    expect(body).toContain("Server=127.0.0.1");
  });

  it("R19: coexists with an agent the client already runs (not port 10050)", () => {
    expect(body).toContain("readonly LISTEN_PORT=31050");
    expect(body).toContain("ListenPort=$LISTEN_PORT");
    expect(body).toMatch(/ListenIP\|ListenPort\|TLSConnect/);
  });

  it("R9: PSK both ways, key file locked down, key never printed", () => {
    expect(body).toContain("TLSConnect=psk");
    expect(body).toContain("TLSAccept=psk");
    expect(body).toContain('install -m 0600 -o zabbix -g zabbix /dev/null "$PSK_FILE"');
    expect(body).not.toMatch(/(say|echo|warn)[^\n]*\$PSK\b/);
  });

  it("R10: HTTPS with TLS 1.2+ for every download", () => {
    expect(body).toMatch(/--proto '=https' --tlsv1\.2 -o "\$TMP_DIR\/zabbix-release\.deb"/);
    expect(body).toContain("https://repo.zabbix.com/zabbix/");
    expect(body).not.toMatch(/http:\/\/repo/);
  });

  it("R11: idempotent configuration", () => {
    expect(body).toContain('OPSDESK_CONF="$CONF_D/opsdesk.conf"');
    expect(body).toMatch(/sed -i -E 's\/\^\(Server\|ServerActive\|Hostname/);
  });

  it("R12: sends a machine-id hash, never the raw id", () => {
    expect(body).toContain("sha256sum /etc/machine-id");
    expect(body).not.toMatch(/"machineId":"\$\(cat/);
  });

  it("R13: verifies config and service, and Done only once the server confirms the agent", () => {
    expect(body).toContain('zabbix_agent2 -c "$CONF" -T');
    expect(body).toContain("systemctl is-active --quiet zabbix-agent2");
    expect(body).toContain('"$OPSDESK_API/enroll/$ENROLL_CODE/status"');
    expect(body).toContain('[ "$state" = AVAILABLE ]');
    // The success message is only reachable after a confirmed AVAILABLE.
    expect(body.indexOf("exit 2")).toBeLessThan(body.indexOf("is now monitored by JSAN"));
  });

  it("R14: numbered steps, final message and a log file", () => {
    expect(body).toContain("/var/log/opsdesk-agent-install.log");
    expect(body).toContain("is now monitored by JSAN");
  });

  it("R15: can uninstall", () => {
    expect(body).toContain("--uninstall) uninstall=1");
  });

  it("R17: agent series comes from the server", () => {
    expect(raw("install.sh")).toContain('ZBX_SERIES="__OPSDESK_ZBX_SERIES__"');
  });

  it("R18: bash parses it", () => {
    if (!available("bash", ["-c", "true"])) return;
    // On stdin, not a temp file: "bash" may be WSL's, which can't read Windows paths.
    const r = spawnSync("bash", ["-n"], { input: sh, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

/**
 * R18: ShellCheck — the standard rules plus the optional checks that matter
 * for an unattended installer (set -e lost in conditions, missing default
 * branches...). Only pure style preferences are excluded. Runs when
 * ShellCheck is on PATH, or through WSL on Windows dev machines.
 */
describe("Linux installer ShellCheck (R18)", () => {
  const args = ["-s", "bash", "-o", "all", "-e", "SC2250,SC2292,SC2312", "-f", "gcc", "-"];
  const runner = available("shellcheck", ["--version"])
    ? { cmd: "shellcheck", pre: [] as string[] }
    : process.platform === "win32" && available("wsl", ["-e", "shellcheck", "--version"])
      ? { cmd: "wsl", pre: ["-e", "shellcheck"] }
      : null;

  (runner ? it : it.skip)("is clean", () => {
    const r = spawnSync(runner!.cmd, [...runner!.pre, ...args], { input: sh, encoding: "utf8" });
    expect(r.stdout + r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("Windows installer (install.ps1) rubric", () => {
  const body = code(ps1);

  it("R1: the whole script is one script block", () => {
    expect(body.trimStart().startsWith("& {")).toBe(true);
    expect(body.trimEnd().endsWith("}")).toBe(true);
  });

  it("R2: stops on errors, strict mode", () => {
    expect(body).toContain("$ErrorActionPreference = 'Stop'");
    expect(body).toContain("Set-StrictMode -Version 2.0");
  });

  it("R3: requires Administrator", () => {
    expect(body).toContain("WindowsBuiltInRole]::Administrator");
    expect(body).toContain("Run as administrator");
  });

  it("R4: silent MSI, no reboot", () => {
    expect(body).toContain("/qn /norestart");
  });

  it("R7: checks the network first", () => {
    expect(body.indexOf("health/live")).toBeLessThan(body.indexOf("Invoke-WebRequest -Uri $MsiUrl"));
    expect(body).toContain("Net.Sockets.TcpClient");
  });

  it("R8 + R9: localhost listener, PSK, locked key file, key never on a command line", () => {
    expect(body).toContain("'ListenIP=127.0.0.1'");
    expect(body).toContain("'TLSConnect=psk'");
    expect(body).toContain("/inheritance:r");
    expect(body).not.toMatch(/msiexec[^\n]*psk/i);
    expect(body).not.toMatch(/\$msiArgs[^\n]*psk/i);
  });

  it("R19: own local port, not 10050", () => {
    expect(body).toContain("'ListenPort=31050'");
    expect(body).toContain("'ListenPort'");
  });

  it("R10: signed MSI over TLS 1.2", () => {
    expect(body).toContain("Get-AuthenticodeSignature");
    expect(body).toContain("Tls12");
    expect(body).toContain("https://cdn.zabbix.com/");
  });

  it("R11 + R15: replaceable config block and uninstall", () => {
    expect(body).toContain("'# >>> OpsDesk'");
    expect(body).toContain("OPSDESK_UNINSTALL");
  });

  it("R13: Done only once the server confirms the agent", () => {
    expect(body).toContain("/enroll/$EnrollCode/status");
    expect(body).toContain("$state -ne 'AVAILABLE'");
  });

  it("R12: machine GUID is hashed", () => {
    expect(body).toContain("SHA256]::Create()");
  });

  it("R18: PowerShell parses it", () => {
    const exe = process.platform === "win32" ? "powershell.exe" : "pwsh";
    if (!available(exe, ["-NoProfile", "-Command", "exit 0"])) return;
    const dir = mkdtempSync(join(tmpdir(), "opsdesk-ps-"));
    try {
      const f = join(dir, "install.ps1");
      writeFileSync(f, ps1);
      const cmd =
        `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$t,[ref]$e)|Out-Null;` +
        `if($e.Count){$e|%{$_.Message};exit 1}`;
      const r = spawnSync(exe, ["-NoProfile", "-Command", cmd], { encoding: "utf8" });
      expect(r.stdout.trim()).toBe("");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
