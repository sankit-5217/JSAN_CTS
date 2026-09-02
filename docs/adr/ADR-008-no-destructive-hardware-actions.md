# ADR-008: Do not permit remote destructive infrastructure actions in v1

**Status:** Accepted

## Context
Arbitrary remote shell/PowerShell execution, firmware updates, reboots or
BIOS changes from a web portal carry significant blast radius if
misused, misconfigured, or exploited — and are explicitly out of scope
for the MVP (spec §3.2, §10.12).

## Decision
v1 hardware integration is read/observe/record only. No control-plane
actions are exposed from the portal without a separately reviewed control
design (future roadmap item, spec §27, gated behind explicit human
approval and audit).

## Consequences
- The `redfish`/`dell-ome` adapters only ever call read endpoints.
- Any future "act on hardware" feature needs its own ADR and security
  review before implementation — this ADR is the default deny.
