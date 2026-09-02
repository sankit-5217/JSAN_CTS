import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: read models/aggregations (spec §10.16, §12).
 * Must not own: source-of-truth mutations.
 *
 * TODO (Sprint 7+): availability by site/CI type, incident volume, MTTA/MTTR,
 * SLA attainment, vendor response/RMA duration, engineer effort reports.
 */
@Module({})
export class ReportsModule {}
