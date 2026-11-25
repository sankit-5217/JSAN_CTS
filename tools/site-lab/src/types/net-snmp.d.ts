/**
 * Minimal ambient types for the parts of `net-snmp` the site lab uses to send
 * traps — the package ships no `.d.ts`. Keep this in step with `traps.ts`.
 */
declare module "net-snmp" {
  export const Version2c: number;
  export const ObjectType: Record<string, number> & {
    Integer: number;
    OctetString: number;
  };

  export interface SessionOptions {
    port?: number;
    trapPort?: number;
    version?: number;
    sourceAddress?: string;
  }

  export interface SessionVarbind {
    oid: string;
    type: number;
    value: string | number;
  }

  export interface Session {
    trap(
      typeOrOid: string,
      varbinds: SessionVarbind[],
      callback: (error: Error | null) => void,
    ): void;
    close(): void;
  }

  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;
}
