import * as snmp from "net-snmp";
import type { ReceiverNotification } from "net-snmp";
import type { DecodedTrapPdu } from "./pdu";
import { NetSnmpTrapListener, pduFromNetSnmp } from "./net-snmp-listener";

function v2c(): ReceiverNotification {
  return {
    pdu: {
      type: snmp.PduType.TrapV2,
      community: "public",
      varbinds: [
        { oid: "1.3.6.1.2.1.1.3.0", type: snmp.ObjectType.TimeTicks, value: 12345 },
        { oid: "1.3.6.1.6.3.1.1.4.1.0", type: snmp.ObjectType.OID, value: "1.3.6.1.6.3.1.1.5.3" },
        { oid: "1.3.6.1.2.1.2.2.1.1.3", type: snmp.ObjectType.Integer, value: 3 },
      ],
    },
    rinfo: { address: "10.20.3.2", port: 41000 },
  };
}

describe("pduFromNetSnmp", () => {
  it("maps a v2c TrapV2 with labelled varbind types", () => {
    expect(pduFromNetSnmp(v2c())).toEqual({
      version: "v2c",
      varbinds: [
        { oid: "1.3.6.1.2.1.1.3.0", value: 12345, type: "TimeTicks" },
        { oid: "1.3.6.1.6.3.1.1.4.1.0", value: "1.3.6.1.6.3.1.1.5.3", type: "OID" },
        { oid: "1.3.6.1.2.1.2.2.1.1.3", value: 3, type: "Integer" },
      ],
    });
  });

  it("maps a v1 Trap, carrying the enterprise / generic / specific / upTime", () => {
    const notification: ReceiverNotification = {
      pdu: {
        type: snmp.PduType.Trap,
        enterprise: "1.3.6.1.4.1.318",
        generic: 6,
        specific: 5,
        upTime: 999,
        varbinds: [{ oid: "1.3.6.1.4.1.318.1", type: snmp.ObjectType.OctetString, value: "x" }],
      },
      rinfo: { address: "10.20.3.9", port: 162 },
    };
    expect(pduFromNetSnmp(notification)).toEqual({
      version: "v1",
      enterprise: "1.3.6.1.4.1.318",
      genericTrap: 6,
      specificTrap: 5,
      upTime: 999,
      varbinds: [{ oid: "1.3.6.1.4.1.318.1", value: "x", type: "OctetString" }],
    });
  });
});

describe("NetSnmpTrapListener", () => {
  function fakeReceiver() {
    const addCommunity = jest.fn();
    const close = jest.fn((cb?: () => void) => cb?.());
    const receiver = { getAuthorizer: () => ({ addCommunity }), close };
    let captured: ((err: Error | null, data?: ReceiverNotification) => void) | undefined;
    const createReceiver = jest.fn((_opts, cb) => {
      captured = cb;
      return receiver;
    }) as unknown as typeof snmp.createReceiver;
    return {
      addCommunity,
      close,
      createReceiver,
      fire: (e: Error | null, d?: ReceiverNotification) => captured?.(e, d),
    };
  }

  it("adds the community and forwards decoded traps to the sink", async () => {
    const { addCommunity, createReceiver, fire } = fakeReceiver();
    const seen: Array<{ pdu: DecodedTrapPdu; addr: string }> = [];
    const listener = new NetSnmpTrapListener({
      port: 1620,
      community: "opsdesk",
      sink: (pdu, addr) => seen.push({ pdu, addr }),
      createReceiver,
    });

    await listener.start();
    expect(addCommunity).toHaveBeenCalledWith("opsdesk");

    fire(null, v2c());
    expect(seen).toHaveLength(1);
    expect(seen[0].addr).toBe("10.20.3.2");
    expect(seen[0].pdu.version).toBe("v2c");
  });

  it("swallows a datagram error without calling the sink", async () => {
    const { createReceiver, fire } = fakeReceiver();
    const sink = jest.fn();
    const listener = new NetSnmpTrapListener({ port: 1620, sink, createReceiver });
    await listener.start();

    fire(new Error("unauthorized"), undefined);
    expect(sink).not.toHaveBeenCalled();
  });

  it("closes the receiver on stop", async () => {
    const { close, createReceiver } = fakeReceiver();
    const listener = new NetSnmpTrapListener({ port: 1620, sink: jest.fn(), createReceiver });
    await listener.start();
    await listener.stop();
    expect(close).toHaveBeenCalled();
  });
});
