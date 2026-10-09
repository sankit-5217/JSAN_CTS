// Generates the snmpsim data files (snmprec/*.snmprec) for the simulated
// client-site devices. Run: node tools/client-site-lab/gen-snmprec.mjs
//
// snmprec line format: OID|TYPE[:variation]|VALUE
//   types: 2 Integer, 4 OctetString, 6 OID, 65 Counter32, 66 Gauge32,
//          67 TimeTicks, 70 Counter64
//   writecache  — value can be changed live with snmpset (lab.sh uses this)
//   numeric     — value moves on its own (counters climb, uptime ticks)
// Lines must be sorted by OID, which this script does.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "snmprec");

const str = (v) => ["4", v];
const int = (v) => ["2", String(v)];
const oid = (v) => ["6", v];
const gauge = (v) => ["66", String(v)];
const cnt32 = (v) => ["65", String(v)];
/** Live-settable value (snmpset). */
const w = (type, v) => [`${type}:writecache`, `value=${v}`];
/** Monotonic counter growing ~rate per second. */
const counter = (type, rate, initial = 1000) => [
  `${type}:numeric`,
  // No `deviation`: snmpsim 1.1 then yields floats, which a Counter cannot hold.
  `rate=${rate},initial=${initial},cumulative=1${type === "65" ? ",wrap=4294967296" : ""}`,
];
const uptime = (initialTicks) => ["67:numeric", `rate=100,initial=${initialTicks},cumulative=1`];

function system({ descr, objectId, name, location }) {
  return {
    "1.3.6.1.2.1.1.1.0": str(descr),
    "1.3.6.1.2.1.1.2.0": oid(objectId),
    "1.3.6.1.2.1.1.3.0": uptime(864000000), // ~100 days
    "1.3.6.1.2.1.1.4.0": str("Client IT desk <it@client-site02.example>"),
    "1.3.6.1.2.1.1.5.0": str(name),
    "1.3.6.1.2.1.1.6.0": str(location),
  };
}

/** IF-MIB ifTable + ifXTable rows. Each port: {name, alias, up, rateBps, speedMbps}. */
function interfaces(ports) {
  const rows = { "1.3.6.1.2.1.2.1.0": int(ports.length) };
  ports.forEach((p, n) => {
    const i = n + 1;
    const base = "1.3.6.1.2.1.2.2.1";
    const x = "1.3.6.1.2.1.31.1.1.1";
    const rate = p.up ? p.rateBps : 0;
    Object.assign(rows, {
      [`${base}.1.${i}`]: int(i),
      [`${base}.2.${i}`]: str(p.name),
      [`${base}.3.${i}`]: int(6), // ethernetCsmacd
      [`${base}.4.${i}`]: int(1500),
      [`${base}.5.${i}`]: gauge(p.speedMbps * 1_000_000),
      [`${base}.7.${i}`]: int(1), // admin up
      [`${base}.8.${i}`]: w("2", p.up ? 1 : 2), // oper status: lab.sh flips this
      [`${base}.10.${i}`]: rate ? counter("65", rate) : cnt32(0),
      [`${base}.13.${i}`]: cnt32(0),
      [`${base}.14.${i}`]: cnt32(0),
      [`${base}.16.${i}`]: rate ? counter("65", Math.round(rate / 3)) : cnt32(0),
      [`${base}.19.${i}`]: cnt32(0),
      [`${base}.20.${i}`]: cnt32(0),
      [`${x}.1.${i}`]: str(p.name),
      [`${x}.6.${i}`]: rate ? counter("70", rate) : ["70", "0"],
      [`${x}.10.${i}`]: rate ? counter("70", Math.round(rate / 3)) : ["70", "0"],
      [`${x}.15.${i}`]: gauge(p.speedMbps),
      [`${x}.18.${i}`]: str(p.alias),
      [`1.3.6.1.2.1.10.7.2.1.19.${i}`]: int(3), // full duplex
    });
  });
  return rows;
}

const FG = "1.3.6.1.4.1.12356.101";
const firewall = {
  ...system({
    descr: "FortiGate-60F",
    objectId: "1.3.6.1.4.1.12356.101.1.441",
    name: "SITE02-FW-001",
    location: "Client office SITE02 / comms room rack A",
  }),
  "1.3.6.1.2.1.47.1.1.1.1.11.1": str("FGT60FTK2109C0D7"),
  "1.3.6.1.2.1.47.1.2.1.1.2.1": str("FortiGate-60F"),
  [`${FG}.4.1.1.0`]: str("v7.2.8,build1639,240313 (GA.M)"), // firmware
  [`${FG}.4.1.3.0`]: w("66", 14), // CPU %
  [`${FG}.4.1.4.0`]: w("66", 41), // memory %
  [`${FG}.4.1.5.0`]: gauge(1907004), // memory KB
  [`${FG}.4.1.6.0`]: gauge(1250), // disk used MB
  [`${FG}.4.1.7.0`]: gauge(117527), // disk MB
  [`${FG}.4.1.8.0`]: w("66", 1834), // sessions
  [`${FG}.4.1.20.0`]: uptime(864000000),
  [`${FG}.4.2.2.0`]: str("27.00745(2024-10-01 02:15)"), // IPS DB
  [`${FG}.4.4.1.0`]: int(4),
  ...Object.fromEntries(
    [1, 2, 3, 4].flatMap((c) => [
      [`${FG}.4.4.2.1.1.${c}`, int(c)],
      [`${FG}.4.4.2.1.2.${c}`, gauge(10 + c * 3)],
    ]),
  ),
  [`${FG}.12.1.1.0`]: w("66", 2), // VPN tunnels up
  [`${FG}.12.2.3.1.1.1`]: int(2), // SSL-VPN enabled
  [`${FG}.12.2.3.1.2.1`]: gauge(6), // SSL-VPN users logged in
  // HA: standalone unit, as a single client-site firewall would be.
  [`${FG}.13.1.1.0`]: int(1),
  [`${FG}.13.1.2.0`]: int(0),
  [`${FG}.13.1.3.0`]: int(128),
  [`${FG}.13.1.4.0`]: int(2),
  [`${FG}.13.1.5.0`]: int(1),
  [`${FG}.13.1.6.0`]: int(1),
  [`${FG}.13.1.7.0`]: str(""),
  // IPS counters (VDOM 1)
  ...Object.fromEntries(
    [42, 40, 0, 3, 11, 20, 8, 35, 7].map((v, k) => [`${FG}.9.2.1.1.${k + 1}.1`, cnt32(v)]),
  ),
  ...interfaces([
    { name: "wan1", alias: "ISP-A primary (Airtel 100M)", up: true, rateBps: 2_500_000, speedMbps: 1000 },
    { name: "wan2", alias: "ISP-B backup (Jio 50M)", up: true, rateBps: 150_000, speedMbps: 1000 },
    { name: "internal", alias: "LAN to SITE02-SW-001", up: true, rateBps: 3_000_000, speedMbps: 1000 },
    { name: "dmz", alias: "DMZ", up: true, rateBps: 40_000, speedMbps: 1000 },
  ]),
};

const sw = {
  ...system({
    descr:
      "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E7, RELEASE SOFTWARE (fc3)",
    objectId: "1.3.6.1.4.1.9.1.1208",
    name: "SITE02-SW-001",
    location: "Client office SITE02 / comms room rack A",
  }),
  "1.3.6.1.2.1.25.1.1.0": uptime(864000000),
  ...interfaces([
    { name: "Gi1/0/1", alias: "Reception PCs", up: true, rateBps: 60_000, speedMbps: 1000 },
    { name: "Gi1/0/2", alias: "Accounts PCs", up: true, rateBps: 90_000, speedMbps: 1000 },
    { name: "Gi1/0/3", alias: "Wi-Fi controller", up: true, rateBps: 400_000, speedMbps: 1000 },
    { name: "Gi1/0/4", alias: "CCTV NVR", up: true, rateBps: 1_200_000, speedMbps: 1000 },
    { name: "Gi1/0/5", alias: "SITE02-SRV-001", up: true, rateBps: 800_000, speedMbps: 1000 },
    { name: "Gi1/0/6", alias: "Access control panel", up: true, rateBps: 5_000, speedMbps: 100 },
    { name: "Gi1/0/7", alias: "spare", up: false, rateBps: 0, speedMbps: 1000 },
    { name: "Gi1/0/8", alias: "Uplink to SITE02-FW-001", up: true, rateBps: 3_000_000, speedMbps: 1000 },
  ]),
};

const UPS = "1.3.6.1.2.1.33.1";
const ups = {
  ...system({
    descr: "APC Web/SNMP Management Card (MB:v4.1.0 PF:v6.9.6 PN:apc_hw05_aos_696.bin)",
    objectId: "1.3.6.1.4.1.318.1.3.27",
    name: "SITE02-UPS-001",
    location: "Client office SITE02 / comms room rack A",
  }),
  [`${UPS}.1.1.0`]: str("APC"),
  [`${UPS}.1.2.0`]: str("Smart-UPS SRT 5000"),
  [`${UPS}.1.3.0`]: str("UPS 16.5 (ID1015)"), // UPS firmware
  [`${UPS}.1.4.0`]: str("AOS 6.9.6"), // management card firmware
  [`${UPS}.2.1.0`]: w("2", 2), // battery status: 2 normal, 3 low, 4 depleted
  [`${UPS}.2.2.0`]: w("2", 0), // seconds on battery
  [`${UPS}.2.3.0`]: w("2", 47), // minutes remaining
  [`${UPS}.2.4.0`]: w("2", 100), // charge %
  [`${UPS}.2.5.0`]: w("2", 2184), // battery voltage, 0.1 V
  [`${UPS}.2.7.0`]: w("2", 27), // battery temperature C
  [`${UPS}.3.3.1.2.1`]: w("2", 500), // input frequency, 0.1 Hz
  [`${UPS}.3.3.1.3.1`]: w("2", 231), // input voltage
  [`${UPS}.4.1.0`]: w("2", 3), // output source: 3 normal, 5 battery
  [`${UPS}.4.4.1.2.1`]: w("2", 230), // output voltage
  [`${UPS}.4.4.1.5.1`]: w("2", 38), // output load %
};

function oidKey(o) {
  return o.split(".").map((n) => n.padStart(10, "0")).join(".");
}

for (const [name, rows] of Object.entries({ "SITE02-FW-001": firewall, "SITE02-SW-001": sw, "SITE02-UPS-001": ups })) {
  const lines = Object.entries(rows)
    .sort(([a], [b]) => (oidKey(a) < oidKey(b) ? -1 : 1))
    .map(([o, [type, value]]) => `${o}|${type}|${value}`);
  writeFileSync(join(OUT, `${name}.snmprec`), lines.join("\n") + "\n");
  console.log(`${name}: ${lines.length} OIDs`);
}
