import type { SnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";
import type { SnmpSource } from "../config";
import { pduToSnmpTrap } from "./pdu";
import type { DecodedTrapPdu, TrapSource } from "./pdu";

/**
 * Binds UDP/162, decodes inbound trap PDUs and hands each one on as an
 * `SnmpTrap`. The production implementation wraps an SNMP library's receiver
 * (e.g. `net-snmp`); this file keeps the wiring + address→CI resolution pure and
 * testable, with a Noop listener so the collector runs with no socket.
 */
export interface TrapListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type TrapHandler = (trap: SnmpTrap) => void;

/** Resolve a source address to an OpsDesk CI code from the configured sources. */
export function createSourceResolver(sources: SnmpSource[]): (address: string) => TrapSource {
  const byAddress = new Map(sources.map((s) => [s.address, s.ciCode]));
  return (address) => ({
    address,
    ...(byAddress.has(address) ? { ciCode: byAddress.get(address) } : {}),
  });
}

/**
 * The bridge a concrete listener calls for every decoded PDU: resolve the
 * source, map to `SnmpTrap`, hand to `onTrap`. Pure — unit-tested directly.
 */
export function makePduSink(
  sources: SnmpSource[],
  onTrap: TrapHandler,
): (pdu: DecodedTrapPdu, address: string) => void {
  const resolve = createSourceResolver(sources);
  return (pdu, address) => {
    onTrap(pduToSnmpTrap(pdu, resolve(address)));
  };
}

/**
 * No-op listener used when the site has no SNMP sources configured — the
 * collector runs without binding a UDP socket. `NetSnmpTrapListener` is the
 * real receiver, wired in `index.ts` whenever `snmpSources` is non-empty.
 */
export class NoopTrapListener implements TrapListener {
  async start(): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn("[collector] no SNMP sources configured — trap listener disabled");
  }
  async stop(): Promise<void> {}
}
