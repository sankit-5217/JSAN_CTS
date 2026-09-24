# Important Functions and Triggers

This document summarizes the important business functions and automated triggers in the JSAN Data Center OpsDesk project. It focuses on functions that control state, integrations, notifications, scheduling, and data flow rather than every CRUD method.

## 1. Core API Functions

### Authentication and authorization

| Function | Location | Purpose |
| --- | --- | --- |
| `validateUserByEmail()` | `apps/api/src/modules/auth/auth.service.ts` | Finds and validates a user by email. |
| `issueToken()` | `apps/api/src/modules/auth/auth.service.ts` | Creates an authentication token or session. |
| `getAccessibleSiteIds()` | `apps/api/src/modules/auth/authz.service.ts` | Determines which sites a user can access. |
| `canAccessSite()` | `apps/api/src/modules/auth/authz.service.ts` | Enforces site-level authorization. |

### Incidents and ticket lifecycle

| Function | Location | Purpose |
| --- | --- | --- |
| `create()` | `apps/api/src/modules/incidents/incidents.service.ts` | Creates an incident and starts related workflows. |
| `createFromAlert()` | `apps/api/src/modules/incidents/incidents.service.ts` | Creates an incident from a normalized alert. |
| `createFromCustomer()` | `apps/api/src/modules/incidents/incidents.service.ts` | Creates an incident reported by a customer. |
| `update()` | `apps/api/src/modules/incidents/incidents.service.ts` | Updates incident data and emits update events. |
| `createTransition()` | `apps/api/src/modules/incidents/incidents.service.ts` | Validates and applies incident state transitions. |
| `getAvailableTransitions()` | `apps/api/src/modules/incidents/incidents.service.ts` | Returns valid next states for an incident. |
| `autoAssign()` | `apps/api/src/modules/incidents/incidents.service.ts` | Assigns an incident using routing rules. |
| `linkAlert()` | `apps/api/src/modules/incidents/incidents.service.ts` | Associates an alert with an incident. |
| `createComment()` | `apps/api/src/modules/incidents/incidents.service.ts` | Adds an incident comment and audit activity. |
| `uploadAttachment()` | `apps/api/src/modules/incidents/incidents.service.ts` | Uploads an incident attachment. |
| `notifyAlertRecovered()` | `apps/api/src/modules/incidents/incidents.service.ts` | Notifies users when a recovered alert closes the incident loop. |

### Alerts and monitoring

| Function | Location | Purpose |
| --- | --- | --- |
| `ingest()` | `apps/api/src/modules/alerts/alerts.service.ts` | Performs alert ingestion, deduplication, correlation, and auto-ticketing. |
| `ingestFromZabbix()` | `apps/api/src/modules/alerts/alerts.service.ts` | Handles Zabbix alerts. |
| `ingestFromAlertmanager()` | `apps/api/src/modules/alerts/alerts.service.ts` | Handles Prometheus Alertmanager alerts. |
| `ingestFromSnmp()` | `apps/api/src/modules/alerts/alerts.service.ts` | Handles SNMP traps. |
| `resolveRule()` | `apps/api/src/modules/alerts/alert-rules.service.ts` | Resolves the alert-processing rule. |
| `recordSnapshots()` | `apps/api/src/modules/monitoring/monitoring.service.ts` | Stores normalized current health snapshots. |
| `recordHeartbeat()` | `apps/api/src/modules/monitoring/monitoring.service.ts` | Records site collector liveness. |
| `raiseOrUpdateHealthAlert()` | `apps/api/src/modules/monitoring/monitoring.service.ts` | Creates or updates a CI health alert. |
| `recoverHealthAlert()` | `apps/api/src/modules/monitoring/monitoring.service.ts` | Marks a health alert as recovered. |

### SLA and worklogs

| Function | Location | Purpose |
| --- | --- | --- |
| `resolvePolicy()` | `apps/api/src/modules/sla/sla.service.ts` | Selects the applicable SLA policy. |
| `startForIncident()` | `apps/api/src/modules/sla/sla.service.ts` | Starts SLA timers for an incident. |
| `onAcknowledged()` | `apps/api/src/modules/sla/sla.service.ts` | Updates acknowledgement timing. |
| `onResolved()` | `apps/api/src/modules/sla/sla.service.ts` | Stops resolution timing. |
| `onPaused()` / `onResumed()` | `apps/api/src/modules/sla/sla.service.ts` | Adjusts SLA timers around pauses. |
| `onPriorityChanged()` | `apps/api/src/modules/sla/sla.service.ts` | Recalculates SLA timing after priority changes. |
| `create()` | `apps/api/src/modules/worklogs/worklogs.service.ts` | Records engineer work against an incident. |
| `correct()` | `apps/api/src/modules/worklogs/worklogs.service.ts` | Corrects an existing worklog. |

### CMDB, routing, and governance

| Function | Location | Purpose |
| --- | --- | --- |
| `create()` / `update()` | `apps/api/src/modules/cmdb/cmdb.service.ts` | Creates and updates configuration items. |
| `createRelation()` | `apps/api/src/modules/cmdb/cmdb.service.ts` | Creates relationships between CIs. |
| `suggestForIncident()` | `apps/api/src/modules/routing/routing.service.ts` | Produces ranked engineer suggestions. |
| `rank()` | `apps/api/src/modules/routing/routing.service.ts` | Scores engineers against routing criteria. |
| `approve()` | `apps/api/src/modules/changes/changes.service.ts` | Approves a change request. |
| `getActiveMaintenanceWindows()` | `apps/api/src/modules/changes/changes.service.ts` | Finds currently active maintenance windows. |
| `transition()` | `apps/api/src/modules/problems/problems.service.ts` | Moves a problem through its lifecycle. |
| `approve()` / `unpublish()` | `apps/api/src/modules/knowledge/knowledge.service.ts` | Controls knowledge article publication. |
| `changeStatus()` | `apps/api/src/modules/risks/risks.service.ts` | Updates risk status. |
| `recordTest()` | `apps/api/src/modules/risks/bcp.service.ts` | Records a business-continuity test. |

### Audit, notifications, and reporting

| Function | Location | Purpose |
| --- | --- | --- |
| `record()` | `apps/api/src/modules/audit/audit.service.ts` | Writes append-only audit events. |
| `notifyUsers()` | `apps/api/src/modules/inbox/inbox.service.ts` | Creates in-app notifications. |
| `enqueue()` | `apps/api/src/common/notifications/notifications.publisher.ts` | Publishes email notification jobs. |
| `getCommandCenterSummary()` | `apps/api/src/modules/reports/reports.service.ts` | Builds the operational dashboard summary. |
| `generateOperationalHealthCsv()` | `apps/api/src/modules/reports/reports.service.ts` | Generates an operational health export. |

## 2. Application-Level Triggers

The project does not currently use PostgreSQL triggers. No `CREATE TRIGGER`, PostgreSQL `NOTIFY`, or `LISTEN` implementation is present.

Automation is implemented with NestJS events, cron jobs, queues, and runtime intervals.

### Incident events

Defined in `apps/api/src/modules/incidents/incident-events.ts`:

- `incident.created`
- `incident.updated`

`IncidentsService` emits these events after the database transaction commits.

### Routing triggers

Implemented in `apps/api/src/modules/routing/routing-offers.service.ts`:

| Trigger | Function | Behavior |
| --- | --- | --- |
| `incident.created` | `onIncidentCreated()` | Creates the first routing offer when automatic assignment is enabled. |
| `incident.updated` | `onIncidentUpdated()` | Cancels pending offers when the incident is assigned or progresses. |
| Every minute | `expireOverdue()` | Expires overdue offers and offers the incident to the next engineer. |

### SLA escalation trigger

Implemented in `apps/api/src/modules/sla/sla-escalation.scanner.ts`:

- `scan()` runs every minute.
- Evaluates acknowledgement and resolution thresholds.
- Records escalation events and audit records.
- Sends in-app and email notifications.

### Inbox cleanup trigger

Implemented in `apps/api/src/modules/inbox/inbox.service.ts`:

- `purgeExpired()` runs daily at 03:00.
- Removes expired notifications.

### Alert-processing trigger chain

The main `ingest()` flow in `apps/api/src/modules/alerts/alerts.service.ts` is:

1. Normalize the incoming alert.
2. Deduplicate using the external event ID and fingerprint.
3. Resolve the site and CI.
4. Apply the configured alert rule.
5. Suppress processing during maintenance when configured.
6. Notify the NOC for paging severities.
7. Correlate the alert to an open incident.
8. Create an incident when auto-ticketing applies.
9. Notify users when a recovered alert closes an already-resolved incident.

## 3. Worker and Queue Functions

### Notifications

Implemented in `apps/worker/src/queues/notifications.queue.ts`:

- `createNotificationsQueue()` creates the BullMQ queue.
- `processNotificationJob()` processes a notification job.
- `createNotificationsWorker()` starts the notification worker.

### SLA timers

Implemented in `apps/worker/src/queues/sla-timers.queue.ts`:

- `relaySlaTimerJob()` forwards SLA timer work to the API.
- `createSlaTimersWorker()` starts the SLA worker.

### Warranty synchronization

Implemented in `apps/worker/src/queues/warranty-sync.queue.ts`:

- `scheduleWarrantySync()` schedules the repeatable job.
- Default schedule: `0 3 * * *`.
- `processWarrantySyncJob()` calls the warranty-resync API endpoint.
- `createWarrantySyncWorker()` processes warranty jobs.

## 4. Collector Functions and Triggers

Implemented in `apps/collector/src/index.ts`:

| Function or trigger | Purpose |
| --- | --- |
| `runHealthPoll()` | Polls Redfish, HPE iLO, and Dell OME endpoints. |
| Health-poll interval | Repeats health polling at the configured interval. |
| `buffer.enqueue()` | Buffers health and SNMP data before delivery. |
| `buffer.flush()` | Sends buffered data to the API. |
| `NetSnmpTrapListener.start()` | Starts the UDP SNMP trap listener. |
| Heartbeat interval | Sends periodic collector heartbeat requests. |
| `shutdown()` | Clears intervals, stops the trap listener, and exits cleanly. |

Supporting functions include:

- `fetchRedfishBundle()` in `apps/collector/src/hw/redfish-fetcher.ts`
- `fetchOmeDeviceBundle()` in `apps/collector/src/hw/ome-fetcher.ts`
- `ingestAlert()` in `apps/collector/src/opsdesk-client.ts`
- `ingestHealthSnapshots()` in `apps/collector/src/opsdesk-client.ts`
- `NetSnmpTrapListener.start()` and `stop()` in `apps/collector/src/snmp/net-snmp-listener.ts`

## 5. Integration Normalizers

These functions convert external system data into the internal normalized format:

- `normalizeRedfishSystem()` in `integrations/redfish/src/normalize.ts`
- `normalizeHpeIloSystem()` in `integrations/hpe-ilo/src/normalize.ts`
- `normalizeDellOmeDevice()` in `integrations/dell-ome/src/normalize.ts`
- `normalizeZabbixEvent()` in `integrations/zabbix/src/normalize.ts`
- `normalizeAlertmanagerAlert()` and `normalizeAlertmanagerWebhook()` in `integrations/prometheus/src/normalize.ts`
- `normalizeSnmpTrap()` in `integrations/snmp/src/normalize.ts`
- `parseInboundEmail()` in `integrations/email/src/parse.ts`
- `renderNotification()` in `integrations/email/src/render.ts`
- `resolveWarrantyProvider()` in `integrations/warranty/src/provider-registry.ts`

## 6. Frontend API Functions

The shared frontend API functions are in `apps/web/src/api/client.ts`:

- `apiGet()`
- `apiPost()`
- `apiPatch()`
- `apiDelete()`
- `apiUpload()`
- `apiDownload()`

These functions attach the bearer token and provide the common API communication layer.

The primary frontend workflow is in `apps/web/src/pages/IncidentDetailPage.tsx`, which handles:

- Incident assignment
- State transitions
- Incident updates
- Comments
- Worklogs
- Attachments
- Routing-offer acceptance and rejection

## 7. Main End-to-End Flow

```text
Monitoring system or hardware
        |
        v
Collector or integration normalizer
        |
        v
Alert ingestion and deduplication
        |
        +--> NOC notification
        |
        +--> Correlation with an existing incident
        |
        +--> Automatic incident creation
                    |
                    v
          incident.created event
                    |
                    v
          Routing offer creation
                    |
                    v
          SLA timers and escalation scanning
                    |
                    v
          Notifications, audit records, and reports
```

The main architectural rule is that business state changes occur through backend services such as `createTransition()`, `ingest()`, `approve()`, and `changeStatus()`. The frontend does not directly control incident state or SLA behavior.
