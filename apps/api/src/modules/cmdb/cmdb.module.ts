import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: Configuration Items, components, relationships, lifecycle (spec §9, §12).
 * Must not own: ticket SLA state.
 *
 * TODO (Sprint 3): CI CRUD, rack/server hierarchy, ci_relations graph,
 * bulk import, search/filter. Follow the `sites` module as a reference pattern.
 */
@Module({})
export class CmdbModule {}
