import { Module } from "@nestjs/common";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: change workflow and maintenance windows (spec §10.6, §12).
 * Must not own: monitoring storage.
 *
 * TODO (Sprint 11): standard/normal/emergency change types, approval flow,
 * maintenance_windows that suppress/annotate expected monitoring alerts,
 * mandatory post-implementation review for emergency changes. Also owns
 * problem/RCA records (spec §10.5) sharing this module's governance track.
 */
@Module({})
export class ChangesModule {}
