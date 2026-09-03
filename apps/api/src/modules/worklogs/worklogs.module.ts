import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { WorklogsService } from "./worklogs.service";
import { IncidentWorklogsController, WorklogsController } from "./worklogs.controller";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: engineer activity and time corrections (spec §10.7, §12).
 * Must not own: authentication.
 *
 * Imports IncidentsModule to reuse IncidentsService.findOneScoped() for
 * site-scope checks, rather than duplicating that logic a third time
 * (CLAUDE.md: cross-module calls go through service interfaces).
 */
@Module({
  imports: [AuthModule, IncidentsModule],
  controllers: [IncidentWorklogsController, WorklogsController],
  providers: [WorklogsService],
  exports: [WorklogsService],
})
export class WorklogsModule {}
