import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";
import { controlHandler } from "./control";
import { createSite, effectiveHealth, type SimServer, type SiteLabEvent } from "./model";
import { redfishHandler } from "./redfish";
import { TrapSender, trapFor } from "./traps";

/**
 * OpsDesk site lab — local stand-ins for an iDRAC and an iLO so the real site
 * collector can be run end to end without hardware. Binds 127.0.0.1 only.
 *
 * Env:
 *   SITE_LAB_BMC_CREDENTIAL   "user:password" the simulated BMCs accept (required)
 *   SITE_LAB_TRAP_TARGET      collector trap listener, default 127.0.0.1:1162
 *   SITE_LAB_TRAP_COMMUNITY   default "public"
 *   SITE_LAB_CONTROL_PORT     default 8600
 *   SITE_LAB_DELL_CI / SITE_LAB_HPE_CI   CI codes, default SITE01-R01-SRV-001 / SITE01-R01-DB-001
 *   SITE_LAB_OPENSSL          openssl binary for the one-time BMC cert, default "openssl" on PATH
 */

const env = process.env;
const credentialRaw = env.SITE_LAB_BMC_CREDENTIAL ?? "";
const sep = credentialRaw.indexOf(":");
if (sep <= 0) {
  throw new Error('SITE_LAB_BMC_CREDENTIAL must be "user:password"');
}
const credential = {
  username: credentialRaw.slice(0, sep),
  password: credentialRaw.slice(sep + 1),
};
const [trapHost, trapPort] = (env.SITE_LAB_TRAP_TARGET ?? "127.0.0.1:1162").split(":");
const controlPort = Number(env.SITE_LAB_CONTROL_PORT ?? 8600);

const servers = createSite({
  dell: {
    ciCode: env.SITE_LAB_DELL_CI ?? "SITE01-R01-SRV-001",
    port: 8601,
    trapSource: "127.0.0.11",
  },
  hpe: { ciCode: env.SITE_LAB_HPE_CI ?? "SITE01-R01-DB-001", port: 8602, trapSource: "127.0.0.12" },
});
const events: SiteLabEvent[] = [];
const log = (server: SimServer | null, message: string) => {
  const event = { at: new Date().toISOString(), server: server?.id ?? "lab", message };
  events.push(event);
  if (events.length > 200) {
    events.shift();
  }
  console.log(`[site-lab] ${event.at} ${event.server} ${message}`);
};

/** Self-signed BMC certificate, like a factory iDRAC/iLO (the collector is
 *  configured with endpointTlsInsecure for LAN management endpoints). */
function bmcCert(): { key: Buffer; cert: Buffer } {
  const dir = join(__dirname, "..", "secrets");
  const keyPath = join(dir, "bmc-key.pem");
  const certPath = join(dir, "bmc-cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true });
    execFileSync(env.SITE_LAB_OPENSSL ?? "openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "3650",
      "-subj",
      "/CN=site-lab-bmc",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ]);
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

const sender = new TrapSender({
  host: trapHost,
  port: Number(trapPort),
  community: env.SITE_LAB_TRAP_COMMUNITY ?? "public",
});

const tls = bmcCert();
for (const server of servers) {
  createHttpsServer(
    tls,
    redfishHandler(server, credential, (s) => {
      s.lastPolledAt = new Date().toISOString();
      log(s, "Redfish poll from the collector");
    }),
  ).listen(server.port, "127.0.0.1", () =>
    log(
      server,
      `${server.vendor} BMC Redfish on https://127.0.0.1:${server.port} for ${server.ciCode}`,
    ),
  );
}

createHttpServer(
  controlHandler({
    servers,
    events,
    onChange: async (server, componentId) => {
      const component = server.components.find((c) => c.id === componentId);
      if (!component) {
        return;
      }
      log(
        server,
        `${component.name} -> ${effectiveHealth(component)}${component.predictive ? " (predicted failure)" : ""}`,
      );
      const spec = trapFor(server, component);
      if (!spec) {
        log(server, "no trap for this change on real hardware; Redfish poll will report it");
        return;
      }
      try {
        await sender.send(server, spec);
        log(server, `SNMP trap ${spec.name} (${spec.oid}) sent from ${server.trapSource}`);
      } catch (err) {
        log(server, `SNMP trap ${spec.name} failed: ${(err as Error).message}`);
      }
    },
  }),
).listen(controlPort, "127.0.0.1", () =>
  log(null, `control panel on http://127.0.0.1:${controlPort}`),
);
