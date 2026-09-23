import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: skill taxonomy + engineer-skill assignments (Phase 1 of
 * skill-based routing) and category -> skill requirements (Phase 2).
 * Must not own: incident assignment or the matching algorithm — that's
 * the routing module (Phase 3), which depends on this one.
 */
@Module({
  imports: [AuthModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
