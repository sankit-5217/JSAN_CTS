// One-time JSAN-side setup (re-runnable): the objects every client site shares.
//   node tools/onboarding-kit/setup-central.mjs
//
// Creates/updates in Zabbix: the vendor-neutral UPS-MIB template, the OpsDesk
// webhook media type, the dedicated read-only "opsdesk-webhook" user that
// receives it, and the action that sends every event carrying a "site" tag to
// OpsDesk. Creates (once) the OpsDesk machine token the webhook uses.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR, loadConfig, secretFile } from "./lib/config.mjs";
import { opsdeskClient } from "./lib/opsdesk.mjs";
import { zabbixCentral, zabbixClient, zabbixVersion } from "./lib/zabbix.mjs";

const cfg = loadConfig();
const log = (m) => console.log(`  ${m}`);

const version = await zabbixVersion(cfg.zabbixUrl).catch((e) => {
  throw new Error(`Zabbix API not reachable at ${cfg.zabbixUrl}: ${e.message}`);
});
if (!String(version).startsWith("7.")) throw new Error(`Zabbix ${version} found; this kit is built for Zabbix 7.x`);
console.log(`Zabbix ${version} at ${cfg.zabbixUrl}`);

const ops = await opsdeskClient(cfg.opsdeskApi, cfg.adminEmail, cfg.adminPassword);
let odk = secretFile("opsdesk-webhook-token");
if (!odk) {
  const created = await ops.call("POST", `/admin/users/${await ops.adminUserId()}/api-tokens`, {
    name: "Zabbix webhook (onboarding kit)",
    expiresInDays: 365,
  });
  mkdirSync(SECRETS_DIR, { recursive: true });
  writeFileSync(join(SECRETS_DIR, "opsdesk-webhook-token"), created.token, { mode: 0o600 });
  odk = created.token;
  log("OpsDesk machine token for the webhook created (secrets/opsdesk-webhook-token, valid 365 days)");
}

const zbx = zabbixClient(cfg.zabbixUrl, cfg.zabbixToken);
const central = zabbixCentral(zbx, log);
await central.ensureUpsTemplate();
const mediatypeid = await central.ensureWebhook(odk, cfg.webhookUrl);
const userid = await central.ensureWebhookUser(mediatypeid);
await central.ensureAction(mediatypeid, userid);
console.log(`Central setup done. Webhook posts to ${cfg.webhookUrl}`);
