import * as snmp from "net-snmp";
import type { ReceiverNotification, ReceiverVarbind } from "net-snmp";
import type { DecodedTrapPdu, RawVarbind } from "./pdu";
import type { TrapListener } from "./trap-listener";

/** net-snmp's numeric ObjectType -> the string label our `RawVarbind` carries. */
function typeName(t: number): string | undefined {
  const name = snmp.ObjectType[t];
  return typeof name === "string" ? name : undefined;
}

function toRawVarbind(vb: ReceiverVarbind): RawVarbind {
  const type = typeName(vb.type);
  return { oid: vb.oid, value: vb.value, ...(type ? { type } : {}) };
}

/**
 * Convert a net-snmp receiver notification into our transport-agnostic
 * {@link DecodedTrapPdu}. Pure — unit-tested directly.
 */
export function pduFromNetSnmp(notification: ReceiverNotification): DecodedTrapPdu {
  const { pdu } = notification;
  const varbinds = (pdu.varbinds ?? []).map(toRawVarbind);

  if (pdu.type === snmp.PduType.Trap) {
    return {
      version: "v1",
      ...(pdu.enterprise ? { enterprise: pdu.enterprise } : {}),
      ...(pdu.generic !== undefined ? { genericTrap: pdu.generic } : {}),
      ...(pdu.specific !== undefined ? { specificTrap: pdu.specific } : {}),
      ...(pdu.upTime !== undefined ? { upTime: pdu.upTime } : {}),
      varbinds,
    };
  }
  return { version: "v2c", varbinds };
}

export interface NetSnmpTrapListenerOptions {
  port: number;
  /** v2c community allowed to submit traps. Default "public". */
  community?: string;
  /** Called for every decoded trap with its source transport address. */
  sink: (pdu: DecodedTrapPdu, address: string) => void;
  /** Injectable for tests; defaults to `net-snmp`'s createReceiver. */
  createReceiver?: typeof snmp.createReceiver;
}

/** UDP trap receiver backed by `net-snmp`. Binds on `start()`, closes on `stop()`. */
export class NetSnmpTrapListener implements TrapListener {
  private receiver: snmp.Receiver | undefined;

  constructor(private readonly opts: NetSnmpTrapListenerOptions) {}

  async start(): Promise<void> {
    const create = this.opts.createReceiver ?? snmp.createReceiver;
    this.receiver = create({ port: this.opts.port, disableAuthorization: false }, (err, data) => {
      if (err || !data) {
        // A malformed / unauthorized datagram must not crash the collector.
        // eslint-disable-next-line no-console
        console.warn(`[collector] dropped SNMP datagram: ${err?.message ?? "no data"}`);
        return;
      }
      try {
        this.opts.sink(pduFromNetSnmp(data), data.rinfo.address);
      } catch (convertErr) {
        // eslint-disable-next-line no-console
        console.warn(
          `[collector] failed to map trap from ${data.rinfo.address}: ${(convertErr as Error).message}`,
        );
      }
    });
    this.receiver.getAuthorizer().addCommunity(this.opts.community ?? "public");
    // eslint-disable-next-line no-console
    console.log(`[collector] SNMP trap listener on udp/${this.opts.port}`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.receiver) {
        resolve();
        return;
      }
      this.receiver.close(() => resolve());
      this.receiver = undefined;
    });
  }
}
