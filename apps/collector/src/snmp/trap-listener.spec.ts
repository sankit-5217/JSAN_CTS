import type { SnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";
import type { V2cNotificationPdu } from "./pdu";
import { createSourceResolver, makePduSink } from "./trap-listener";

const SOURCES = [
  { address: "10.20.3.2", ciCode: "SITE01-R03-SW-002" },
  { address: "10.20.3.9", ciCode: "SITE01-R00-PDU-004" },
];

describe("createSourceResolver", () => {
  it("resolves a known address and leaves an unknown one without a ciCode", () => {
    const resolve = createSourceResolver(SOURCES);
    expect(resolve("10.20.3.2")).toEqual({ address: "10.20.3.2", ciCode: "SITE01-R03-SW-002" });
    expect(resolve("10.20.9.99")).toEqual({ address: "10.20.9.99" });
  });
});

describe("makePduSink", () => {
  it("resolves the source, maps the PDU and forwards the SnmpTrap", () => {
    const seen: SnmpTrap[] = [];
    const sink = makePduSink(SOURCES, (trap) => seen.push(trap));

    const pdu: V2cNotificationPdu = {
      version: "v2c",
      varbinds: [
        { oid: "1.3.6.1.2.1.1.3.0", type: "TimeTicks", value: 42 },
        { oid: "1.3.6.1.6.3.1.1.4.1.0", type: "OID", value: "1.3.6.1.6.3.1.1.5.3" },
      ],
    };
    sink(pdu, "10.20.3.2");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      ciCode: "SITE01-R03-SW-002",
      agentAddress: "10.20.3.2",
      trapOid: "1.3.6.1.6.3.1.1.5.3",
      sysUpTimeTicks: 42,
    });
  });
});
