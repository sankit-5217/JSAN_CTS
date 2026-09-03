# SNMP trap adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/snmp-adapter`.

Normalizes a **parsed** SNMP trap / inform into the same
`NormalizedAlertPayload` contract as the Zabbix and Alertmanager adapters
(`packages/shared-types/src/alert.ts`), so non-Redfish gear — switches, PDUs,
UPS, environmental sensors, older servers via OMSA — feeds the alerts pipeline
through the same idempotent `ingest()` path. Build order: Sprint 9/10.

## What this package does

```
normalizeSnmpTrap(trap: SnmpTrap): NormalizedAlertPayload
```

- Deterministic, no I/O, **no MIB loading** — the site collector's trap receiver
  decodes the PDU (and resolves OIDs against its MIBs) first.
- Recognises the standard SNMPv2-MIB / IF-MIB traps (`coldStart`, `warmStart`,
  `linkDown`, `linkUp`, `authenticationFailure`, `egpNeighborLoss`).
  **`linkDown` and `linkUp` share one `alertType` (`network.link_state`) plus the
  interface component** so the alerts pipeline pairs the fault with its recovery
  by fingerprint (site + CI + alertType + component).
- Synthesises the trap OID for a raw **SNMPv1** trap per RFC 3584: generic-trap
  0–5 → the standard OIDs; generic-trap 6 (enterpriseSpecific) →
  `<enterprise>.0.<specific>`.
- Any other trap → `snmp.<trapName | last OID arcs>` at `WARNING` / `OPEN`,
  unless the collector supplies `severity` (from vendor-MIB knowledge) or
  `clears: true` (a vendor "clear" trap → `RECOVERED`).
- `eventId` is **occurrence-unique** (`sysUpTime`-keyed): a retransmitted inform
  dedupes, a fresh fault gets a new id. Pairing a fault with its later clear is
  the alerts pipeline's job (by fingerprint), not this adapter's.
- Throws `SnmpNormalizationError` (with `.field`) when `ciCode` / `agentAddress`
  is missing, no trap OID can be determined, or `receivedAt` is unparseable.

## Input

The trap PDU carries no OpsDesk identifiers, so the collector MUST resolve the
source address to a `ciCode` (and ideally `siteCode`, else it is taken from a
`SITE01-…` prefix on the CI code) before calling — see `src/types.ts`.

## Not in this package

The collector's UDP/162 trap listener, SNMPv3 USM auth, MIB compilation, and the
`ingest()` call itself. SNMP management ports stay behind the site collector,
which connects outbound over TLS/mTLS — never Internet-facing (spec §11). SNMP
_polling_ of health OIDs (→ `HealthSnapshotPayload`, `source: "SNMP"`) for gear
with no Redfish is a separate follow-up. Tests use sanitized fixture traps
(spec §21).
