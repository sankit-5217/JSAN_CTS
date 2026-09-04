import { pduToSnmpTrap } from "./pdu";
import type { V1TrapPdu, V2cNotificationPdu } from "./pdu";

const AT = "2026-09-03T10:15:00.000Z";

describe("pduToSnmpTrap", () => {
  it("maps a v2c notification: pulls sysUpTime + snmpTrapOID, keeps data varbinds", () => {
    const pdu: V2cNotificationPdu = {
      version: "v2c",
      varbinds: [
        { oid: "1.3.6.1.2.1.1.3.0", type: "TimeTicks", value: 123456 },
        { oid: "1.3.6.1.6.3.1.1.4.1.0", type: "OID", value: "1.3.6.1.6.3.1.1.5.3" },
        { oid: "1.3.6.1.2.1.2.2.1.1.3", type: "Integer", value: 3 },
        { oid: "1.3.6.1.2.1.31.1.1.1.1.3", type: "OctetString", value: Buffer.from("Gi1/0/3") },
      ],
    };

    const trap = pduToSnmpTrap(pdu, { address: "10.20.3.2", ciCode: "SITE01-R03-SW-002" }, AT);

    expect(trap).toEqual({
      ciCode: "SITE01-R03-SW-002",
      agentAddress: "10.20.3.2",
      receivedAt: AT,
      version: "v2c",
      trapOid: "1.3.6.1.6.3.1.1.5.3",
      sysUpTimeTicks: 123456,
      varbinds: [
        { oid: "1.3.6.1.2.1.2.2.1.1.3", value: 3, type: "Integer" },
        { oid: "1.3.6.1.2.1.31.1.1.1.1.3", value: "Gi1/0/3", type: "OctetString" },
      ],
    });
  });

  it("maps a raw v1 trap into the v1 block (adapter synthesises the OID)", () => {
    const pdu: V1TrapPdu = {
      version: "v1",
      enterprise: "1.3.6.1.4.1.318",
      genericTrap: 6,
      specificTrap: 5,
      upTime: 987654,
      varbinds: [{ oid: "1.3.6.1.4.1.318.1", type: "OctetString", value: "on battery" }],
    };

    const trap = pduToSnmpTrap(pdu, { address: "10.20.3.9", ciCode: "SITE01-R00-PDU-004" }, AT);

    expect(trap).toEqual({
      ciCode: "SITE01-R00-PDU-004",
      agentAddress: "10.20.3.9",
      receivedAt: AT,
      version: "v1",
      v1: { enterprise: "1.3.6.1.4.1.318", genericTrap: 6, specificTrap: 5 },
      sysUpTimeTicks: 987654,
      varbinds: [{ oid: "1.3.6.1.4.1.318.1", value: "on battery", type: "OctetString" }],
    });
    expect(trap.trapOid).toBeUndefined();
  });

  it("leaves ciCode blank for an unresolved source address", () => {
    const pdu: V2cNotificationPdu = {
      version: "v2c",
      varbinds: [{ oid: "1.3.6.1.6.3.1.1.4.1.0", type: "OID", value: "1.3.6.1.6.3.1.1.5.1" }],
    };
    const trap = pduToSnmpTrap(pdu, { address: "10.20.9.99" }, AT);
    expect(trap.ciCode).toBe("");
    expect(trap.agentAddress).toBe("10.20.9.99");
  });
});
