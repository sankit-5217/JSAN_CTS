import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InboxModule } from "../inbox/inbox.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { ShiftsModule } from "../shifts/shifts.module";
import { SkillsModule } from "../skills/skills.module";
import { RoutingController, RoutingPoliciesController } from "./routing.controller";
import { RoutingOffersService } from "./routing-offers.service";
import { RoutingService } from "./routing.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: the skill-based routing algorithm (Phase 3) — matching an incident
 * to engineers who are on shift at its site and hold every skill its
 * category requires — the per-site RoutingPolicy, and routing offers. With
 * a site's auto-routing on, it listens for incident.created and offers the
 * ticket to one engineer at a time (RoutingOffersService). On accept it
 * asks the incidents module to move the ticket NEW -> ASSIGNED; it never
 * writes incident rows itself, and records timeline entries through
 * IncidentsService.recordRoutingEvent.
 *
 * Must not own: the skill taxonomy/requirements (skills module), shift
 * schedules (shifts module) or incident assignment (incidents module) —
 * it reads all three through their exported services, never their tables.
 */
@Module({
  imports: [AuthModule, InboxModule, IncidentsModule, ShiftsModule, SkillsModule],
  controllers: [RoutingController, RoutingPoliciesController],
  providers: [RoutingService, RoutingOffersService],
})
export class RoutingModule {}
