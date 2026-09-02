# ADR-004: Use a secure outbound site collector for infrastructure management integration

**Status:** Accepted

## Context

iDRAC/iLO/SNMP management interfaces must stay inside the local site
network. Inbound firewall openings to reach them from the central platform
are a security liability and fragile against intermittent connectivity.

## Decision

A lightweight collector (Docker/VM, per spec §11) runs at each site,
queries approved local endpoints, normalizes payloads, and pushes events
outbound over HTTPS/mTLS to the central OpsDesk API. It buffers locally on
disconnect and uploads idempotently (unique event IDs) on reconnect. It
never stores central user credentials — only scoped machine credentials
from a secret store.

## Consequences

- No inbound ports opened to any site's management plane.
- Central platform must tolerate delayed/buffered events from collectors.
- Collector heartbeat per site must be monitored (spec §26) so a silent
  collector doesn't look like "everything is healthy."
