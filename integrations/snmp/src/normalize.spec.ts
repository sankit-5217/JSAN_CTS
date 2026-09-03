import { normalizeSnmpTrap, SnmpNormalizationError } from "./normalize";
import type { SnmpTrap } from "./types";

function trap(overrides: Partial<SnmpTrap> = {}): SnmpTrap {
  return {
    ciCode: "SITE01-R03-SW-002",
    agentAddress: "10.20.3.2",
    version: "v2c",
    receivedAt: "2026-09-02T10:15:00.000Z",
    sysUpTimeTicks: 123456,
    trapOid: "1.3.6.1.6.3.1.1.5.3", // linkDown
    trapName: "linkDown",
    varbinds: [
      { oid: "1.3.6.1.2.1.2.2.1.1.3", name: "ifIndex", value: 3, type: "Integer" },
      { oid: "1.3.6.1.2.1.31.1.1.1.1.3", name: "ifName", value: "Gi1/0/3", type: "OctetString" },
      { oid: "1.3.6.1.2.1.2.2.1.8.3", name: "ifOperStatus", value: 2, type: "Integer" },
    ],
    ...overrides,
  };
}

describe("normalizeSnmpTrap", () => {
  it("maps a linkDown trap to an OPEN network.link_state alert", () => {
    const alert = normalizeSnmpTrap(trap());

    expect(alert).toMatchObject({
      source: "SNMP",
      siteCode: "SITE01",
      ciCode: "SITE01-R03-SW-002",
      alertType: "network.link_state",
      severity: "HIGH",
      componentKey: "if:Gi1/0/3",
      state: "OPEN",
      occurredAt: "2026-09-02T10:15:00.000Z",
    });
    expect(alert.eventId).toBe("snmp-site01_r03_sw_002-network_link_state-if_gi1_0_3-123456");
    expect(alert.attributes).toMatchObject({
      trapOid: "1.3.6.1.6.3.1.1.5.3",
      snmpVersion: "v2c",
      varbinds: { ifIndex: 3, ifName: "Gi1/0/3", ifOperStatus: 2 },
    });
  });

  it("maps linkUp to the same alertType + component but state RECOVERED (pairs by fingerprint)", () => {
    const down = normalizeSnmpTrap(trap());
    const up = normalizeSnmpTrap(
      trap({ trapOid: "1.3.6.1.6.3.1.1.5.4", trapName: "linkUp", sysUpTimeTicks: 200000 }),
    );

    expect(up.alertType).toBe(down.alertType);
    expect(up.componentKey).toBe(down.componentKey);
    expect(up.state).toBe("RECOVERED");
    expect(up.severity).toBe("INFO");
    expect(up.eventId).not.toBe(down.eventId); // occurrence-unique
  });

  it("synthesises the trap OID from a raw SNMPv1 generic-trap (linkDown = 2)", () => {
    const alert = normalizeSnmpTrap(
      trap({ trapOid: undefined, trapName: undefined, version: "v1", v1: { genericTrap: 2 } }),
    );

    expect(alert.attributes).toMatchObject({ trapOid: "1.3.6.1.6.3.1.1.5.3" });
    expect(alert.alertType).toBe("network.link_state");
    expect(alert.severity).toBe("HIGH");
  });

  it("synthesises an enterprise-specific OID from SNMPv1 generic-trap 6", () => {
    const alert = normalizeSnmpTrap(
      trap({
        trapOid: undefined,
        trapName: "apcUpsOnBattery",
        version: "v1",
        v1: { enterprise: "1.3.6.1.4.1.318", genericTrap: 6, specificTrap: 5 },
        varbinds: [],
      }),
    );

    expect(alert.attributes).toMatchObject({ trapOid: "1.3.6.1.4.1.318.0.5" });
    expect(alert.alertType).toBe("snmp.apcupsonbattery");
    expect(alert.severity).toBe("WARNING");
    expect(alert.state).toBe("OPEN");
  });

  it("falls back to snmp.<name> at WARNING for an unrecognised trap", () => {
    const alert = normalizeSnmpTrap(
      trap({
        trapOid: "1.3.6.1.4.1.674.10892.5.3.2.1",
        trapName: "alertPhysicalDiskFailure",
        varbinds: [
          { oid: "1.3.6.1.4.1.674.10892.5.3.1.1", name: "component", value: "Disk 0:1:5" },
        ],
      }),
    );

    expect(alert.alertType).toBe("snmp.alertphysicaldiskfailure");
    expect(alert.severity).toBe("WARNING");
    expect(alert.componentKey).toBe("Disk 0:1:5");
  });

  it("lets the collector override severity and mark a clear trap", () => {
    const alert = normalizeSnmpTrap(trap({ severity: "CRITICAL", clears: true }));

    expect(alert.severity).toBe("CRITICAL");
    expect(alert.state).toBe("RECOVERED");
  });

  it("derives the site from the CI code prefix when siteCode is absent", () => {
    const alert = normalizeSnmpTrap(trap({ siteCode: undefined, ciCode: "DC7-R01-PDU-004" }));
    expect(alert.siteCode).toBe("DC7");
  });

  it("dedupes retransmits (same sysUpTime → same eventId) but not new occurrences", () => {
    const first = normalizeSnmpTrap(trap({ sysUpTimeTicks: 999 }));
    const retransmit = normalizeSnmpTrap(trap({ sysUpTimeTicks: 999 }));
    const later = normalizeSnmpTrap(trap({ sysUpTimeTicks: 5000 }));

    expect(retransmit.eventId).toBe(first.eventId);
    expect(later.eventId).not.toBe(first.eventId);
  });

  it("throws SnmpNormalizationError for missing ciCode, no OID, or a bad timestamp", () => {
    expect(() => normalizeSnmpTrap(trap({ ciCode: "  " }))).toThrow(SnmpNormalizationError);
    expect(() =>
      normalizeSnmpTrap(trap({ trapOid: undefined, trapName: undefined, v1: undefined })),
    ).toThrow(SnmpNormalizationError);

    try {
      normalizeSnmpTrap(trap({ receivedAt: "last tuesday" }));
      throw new Error("expected normalizeSnmpTrap to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SnmpNormalizationError);
      expect((err as SnmpNormalizationError).field).toBe("receivedAt");
    }
  });
});
