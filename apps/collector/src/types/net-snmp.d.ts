/**
 * Minimal ambient types for the parts of `net-snmp` the collector uses — the
 * package ships no `.d.ts`. Keep this in step with `snmp/net-snmp-listener.ts`.
 */
declare module "net-snmp" {
  export const PduType: Record<string, number> & { Trap: number; TrapV2: number };
  export const ObjectType: Record<string, number> & Record<number, string>;

  export interface ReceiverVarbind {
    oid: string;
    type: number;
    value: string | number | boolean | Buffer | null;
  }

  export interface ReceiverPdu {
    type: number;
    varbinds?: ReceiverVarbind[];
    community?: string;
    // v1 trap fields
    enterprise?: string;
    agentAddr?: string;
    generic?: number;
    specific?: number;
    upTime?: number;
  }

  export interface ReceiverNotification {
    pdu: ReceiverPdu;
    rinfo: { address: string; port: number };
  }

  export interface Authorizer {
    addCommunity(community: string): void;
  }

  export interface Receiver {
    getAuthorizer(): Authorizer;
    close(callback?: () => void): void;
  }

  export interface ReceiverOptions {
    port?: number;
    address?: string;
    disableAuthorization?: boolean;
    transport?: "udp4" | "udp6";
  }

  export function createReceiver(
    options: ReceiverOptions,
    callback: (error: Error | null, notification?: ReceiverNotification) => void,
  ): Receiver;
}
