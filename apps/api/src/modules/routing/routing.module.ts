import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { ShiftsModule } from "../shifts/shifts.module";
import { SkillsModule } from "../skills/skills.module";
import { RoutingController } from "./routing.controller";
import { RoutingService } from "./routing.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: the skill-based routing algorithm (Phase 3) — matching an incident
 * to engineers who are on shift at its site and hold every skill its
 * category requires. Suggest-only: it never writes an assignment; the desk
 * picks a candidate and assigns through the incidents module's own
 * audited reassign path.
 *
 * Must not own: the skill taxonomy/requirements (skills module), shift
 * schedules (shifts module) or incident assignment (incidents module) —
 * it reads all three through their exported services, never their tables.
 */
@Module({
  imports: [AuthModule, IncidentsModule, ShiftsModule, SkillsModule],
  controllers: [RoutingController],
  providers: [RoutingService],
})
export class RoutingModule {}
