// Kit configuration: environment variables plus files in tools/onboarding-kit/secrets/ (gitignored).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SECRETS_DIR = join(KIT_DIR, "secrets");
export const OUT_DIR = join(KIT_DIR, "out");

export function secretFile(name) {
  const p = join(SECRETS_DIR, name);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : null;
}

export function loadConfig() {
  const zabbixToken = process.env.ZABBIX_API_TOKEN ?? secretFile("zabbix-api-token");
  if (!zabbixToken) {
    throw new Error(`No Zabbix API token: put one in ${join(SECRETS_DIR, "zabbix-api-token")} or set ZABBIX_API_TOKEN`);
  }
  const adminEmail = process.env.OPSDESK_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.OPSDESK_ADMIN_PASSWORD ?? secretFile("opsdesk-admin-password");
  if (!adminPassword) {
    throw new Error(
      `No OpsDesk admin password: set OPSDESK_ADMIN_PASSWORD or put it in ${join(SECRETS_DIR, "opsdesk-admin-password")}`,
    );
  }
  return {
    zabbixUrl: process.env.ZABBIX_URL ?? "http://127.0.0.1/zabbix/api_jsonrpc.php",
    zabbixToken,
    opsdeskApi: process.env.OPSDESK_API ?? "http://127.0.0.1:3000/api/v1",
    adminEmail,
    adminPassword,
    // The address the *Zabbix server* uses to reach OpsDesk (not the browser's).
    webhookUrl: process.env.WEBHOOK_URL ?? "http://127.0.0.1:3000/api/v1/alerts/sources/zabbix",
  };
}

/** --flag value / --flag=value / --switch parser. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
