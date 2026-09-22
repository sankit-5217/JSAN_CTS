import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: skill taxonomy + engineer-skill assignments (Phase 1 of
 * skill-based routing). Must not own: incident assignment, or which skill
 * a category/alert requires — those are later routing-engine phases that
 * will depend on this module, not fold into it.
 */
@Module({
  imports: [AuthModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
