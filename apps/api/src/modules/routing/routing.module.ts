import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InboxModule } from "../inbox/inbox.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { ShiftsModule } from "../shifts/shifts.module";
import { SitesModule } from "../sites/sites.module";
import { SkillsModule } from "../skills/skills.module";
import {
  CategoryTeamsController,
  RoutingController,
  RoutingPoliciesController,
} from "./routing.controller";
import { CategoryTeamsService } from "./category-teams.service";
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
 * Also owns the category -> team mapping (CategoryTeam); the teams and
 * their members belong to the sites module and are read through
 * SitesService.
 *
 * Must not own: the skill taxonomy/requirements (skills module), shift
 * schedules (shifts module) or incident assignment (incidents module) —
 * it reads all three through their exported services, never their tables.
 */
@Module({
  imports: [AuthModule, InboxModule, IncidentsModule, ShiftsModule, SkillsModule, SitesModule],
  controllers: [RoutingController, RoutingPoliciesController, CategoryTeamsController],
  providers: [RoutingService, RoutingOffersService, CategoryTeamsService],
})
export class RoutingModule {}
