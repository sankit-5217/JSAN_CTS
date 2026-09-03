import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CisController } from "./cmdb.controller";
import { CmdbService } from "./cmdb.service";
import { RacksController } from "./racks.controller";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: Configuration Items, components, relationships, lifecycle (spec §9, §12).
 * Must not own: ticket SLA state.
 *
 * Routes are flat (`/cis`, `/racks`), matching the spec's own API table
 * (§14.1: `/api/v1/cis`) rather than nesting under `/sites/:siteId`.
 */
@Module({
  imports: [AuthModule],
  controllers: [CisController, RacksController],
  providers: [CmdbService],
  exports: [CmdbService],
})
export class CmdbModule {}
