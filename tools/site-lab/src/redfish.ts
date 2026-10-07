import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { effectiveHealth, rollup, type SimComponent, type SimServer } from "./model";

/**
 * Renders a simulated server as the DMTF Redfish resources the collector reads
 * (apps/collector/src/hw/redfish-fetcher.ts): ServiceRoot, Systems, the
 * System, Storage -> controller -> Drives, Chassis Thermal and Power. HPE
 * systems also carry `Oem.Hpe.AggregateHealthStatus`, like a real iLO.
 *
 * Read-only on purpose — anything but GET is 405 (CLAUDE.md: no destructive
 * hardware actions, and the collector never sends any).
 */

type Json = Record<string, unknown>;

const status = (health: string): Json => ({ State: "Enabled", Health: health });

function controllerId(server: SimServer): string {
  return server.vendor === "DELL" ? "RAID.Integrated.1-1" : "DE00A000";
}

function driveId(server: SimServer, c: SimComponent): string {
  return server.vendor === "DELL" ? (c.fqdd as string) : c.id.replace("disk-", "");
}

export function resourceFor(server: SimServer, path: string): Json | undefined {
  const sys = `/redfish/v1/Systems/${server.systemId}`;
  const chassis = `/redfish/v1/Chassis/${server.systemId}`;
  const storage = `${sys}/Storage`;
  const ctl = `${storage}/${controllerId(server)}`;
  const drives = server.components.filter((c) => c.kind === "drive");
  const fans = server.components.filter((c) => c.kind === "fan");
  const psus = server.components.filter((c) => c.kind === "psu");
  const overall = rollup(server.components);

  if (path === "/redfish/v1" || path === "/redfish/v1/") {
    return {
      "@odata.id": "/redfish/v1",
      RedfishVersion: "1.15.0",
      Name: `${server.vendor === "DELL" ? "iDRAC" : "iLO"} Root Service (OpsDesk site lab)`,
      Systems: { "@odata.id": "/redfish/v1/Systems" },
      Chassis: { "@odata.id": "/redfish/v1/Chassis" },
    };
  }
  if (path === "/redfish/v1/Systems") {
    return { Members: [{ "@odata.id": sys }], "Members@odata.count": 1 };
  }
  if (path === sys) {
    const system: Json = {
      "@odata.id": sys,
      Id: server.systemId,
      Name: "System",
      Manufacturer: server.manufacturer,
      Model: server.model,
      SerialNumber: server.serviceTag,
      SKU: server.serviceTag,
      PowerState: "On",
      BiosVersion: server.vendor === "DELL" ? "1.13.2" : "U46 v2.80",
      Status: { State: "Enabled", Health: overall, HealthRollup: overall },
      ProcessorSummary: { Count: 2, Status: status("OK") },
      MemorySummary: { TotalSystemMemoryGiB: 512, Status: status("OK") },
      Storage: { "@odata.id": storage },
    };
    if (server.vendor === "HPE") {
      system.Oem = {
        Hpe: {
          AggregateHealthStatus: {
            Fans: { Status: { Health: rollup(fans) } },
            PowerSupplies: { Status: { Health: rollup(psus) } },
            Storage: { Status: { Health: rollup(drives) } },
            Processors: { Status: { Health: "OK" } },
            Memory: { Status: { Health: "OK" } },
            Temperatures: { Status: { Health: "OK" } },
          },
          PostState: "FinishedPost",
        },
      };
    }
    return system;
  }
  if (path === storage) {
    return { Members: [{ "@odata.id": ctl }], "Members@odata.count": 1 };
  }
  if (path === ctl) {
    return {
      "@odata.id": ctl,
      Id: controllerId(server),
      Name: server.vendor === "DELL" ? "PERC H755 Front" : "HPE Smart Array P408i-a",
      Status: { State: "Enabled", Health: rollup(drives), HealthRollup: rollup(drives) },
      Drives: drives.map((d) => ({ "@odata.id": `${ctl}/Drives/${driveId(server, d)}` })),
    };
  }
  const drive = drives.find((d) => path === `${ctl}/Drives/${driveId(server, d)}`);
  if (drive) {
    return {
      "@odata.id": path,
      Id: driveId(server, drive),
      Name: drive.name,
      Model: server.vendor === "DELL" ? "MZ7L3960HCJR0D3" : "VK000960GXAUU",
      SerialNumber: drive.serial,
      MediaType: "SSD",
      Protocol: "SATA",
      CapacityBytes: 960197124096,
      FailurePredicted: drive.predictive,
      PredictedMediaLifeLeftPercent: drive.predictive ? 2 : 97,
      Status: status(drive.health),
    };
  }
  if (path === "/redfish/v1/Chassis") {
    return { Members: [{ "@odata.id": chassis }], "Members@odata.count": 1 };
  }
  if (path === `${chassis}/Thermal`) {
    return {
      "@odata.id": path,
      Temperatures: [
        {
          Name: "System Board Inlet Temp",
          ReadingCelsius: 22,
          UpperThresholdCritical: 47,
          Status: status("OK"),
        },
      ],
      Fans: fans.map((f) => {
        const h = effectiveHealth(f);
        return {
          Name: f.name,
          Reading: h === "Critical" ? 0 : h === "Warning" ? 2400 : 8400,
          ReadingUnits: "RPM",
          Status: status(h),
        };
      }),
    };
  }
  if (path === `${chassis}/Power`) {
    return {
      "@odata.id": path,
      PowerControl: [{ PowerConsumedWatts: 412 }],
      PowerSupplies: psus.map((p) => {
        const h = effectiveHealth(p);
        return {
          Name: p.name,
          SerialNumber: p.serial,
          PowerInputWatts: h === "Critical" ? 0 : 206,
          LineInputVoltage: h === "Critical" ? 0 : 230,
          Status: status(h),
        };
      }),
    };
  }
  return undefined;
}

function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** HTTP handler for one BMC: Basic auth, GET only, JSON resources. */
export function redfishHandler(
  server: SimServer,
  credential: { username: string; password: string },
  onPoll: (server: SimServer) => void,
) {
  const expected = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
  return (req: IncomingMessage, res: ServerResponse): void => {
    const send = (code: number, body: Json) => {
      res.writeHead(code, { "content-type": "application/json", "OData-Version": "4.0" });
      res.end(JSON.stringify(body));
    };
    if (!sameSecret(req.headers.authorization ?? "", expected)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Redfish"');
      send(401, { error: { code: "Base.1.8.GeneralError", message: "Unauthorized" } });
      return;
    }
    if (req.method !== "GET") {
      send(405, { error: { message: "Read-only simulator: only GET is supported" } });
      return;
    }
    const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
    const body = resourceFor(server, path);
    if (!body) {
      send(404, { error: { message: `No resource at ${path}` } });
      return;
    }
    if (path === `/redfish/v1/Systems/${server.systemId}`) {
      onPoll(server);
    }
    send(200, body);
  };
}
