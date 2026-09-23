import { Injectable, Logger } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { OPEN_STATUSES } from "../incidents/incident-transitions";
import { IncidentsService } from "../incidents/incidents.service";
import { RosterEntry, ShiftsService } from "../shifts/shifts.service";
import { SkillsService } from "../skills/skills.service";

/** Why `candidates` is empty — null whenever there is at least one. */
export type RoutingEmptyReason =
  "INCIDENT_NOT_OPEN" | "NO_SKILL_REQUIREMENTS" | "NO_ENGINEERS_ON_SHIFT" | "NO_QUALIFIED_ENGINEER";

export interface RoutingSkillRef {
  id: string;
  name: string;
}

export interface RoutingCandidate {
  userId: string;
  displayName: string;
  email: string;
  shiftLabel: string;
  isOnCall: boolean;
  openIncidentCount: number;
  isCurrentOwner: boolean;
}

export interface RoutingSuggestions {
  incidentId: string;
  category: string;
  asOf: string;
  requiredSkills: RoutingSkillRef[];
  candidates: RoutingCandidate[];
  reason: RoutingEmptyReason | null;
  /** Required skills nobody currently on shift at the site holds — only
   * populated for NO_QUALIFIED_ENGINEER, so the desk can see the gap. */
  uncoveredSkills: RoutingSkillRef[];
}

/**
 * Skill-based routing, Phase 3 (suggest only). Rules:
 *  1. Pool = engineers whose shift is live right now at the incident's site
 *     (shifts module's live roster, same timezone logic as GET /shifts/live).
 *  2. A candidate must hold EVERY active skill the incident's category
 *     requires (skills module's category requirements).
 *  3. Working-shift engineers are preferred; on-call engineers are only
 *     suggested when no working engineer qualifies.
 *  4. Ranked by fewest open incidents currently owned, then name.
 * Empty results always carry a `reason` instead of silently widening the
 * pool — the desk assigns manually or to a group queue from there.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly shiftsService: ShiftsService,
    private readonly skillsService: SkillsService,
  ) {}

  async suggestForIncident(
    incidentId: string,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<RoutingSuggestions> {
    // Scoped fetch — enforces the caller's site access (403 otherwise).
    const incident = await this.incidentsService.findOneScoped(incidentId, user);

    const result: RoutingSuggestions = {
      incidentId: incident.id,
      category: incident.category,
      asOf: now.toISOString(),
      requiredSkills: [],
      candidates: [],
      reason: null,
      uncoveredSkills: [],
    };

    if (!OPEN_STATUSES.includes(incident.status)) {
      return this.empty(result, "INCIDENT_NOT_OPEN");
    }

    const requiredSkills = await this.skillsService.findRequiredSkillsForCategory(
      incident.category,
    );
    result.requiredSkills = requiredSkills.map(({ id, name }) => ({ id, name }));
    if (requiredSkills.length === 0) {
      return this.empty(result, "NO_SKILL_REQUIREMENTS");
    }

    // Caller's site access was already checked above, so the roster read
    // itself runs unrestricted, narrowed to just this incident's site.
    const roster = await this.shiftsService.getLiveRoster({ siteId: incident.siteId }, null, now);
    const onShift = this.dedupeByEngineer([...roster.working, ...roster.onCall]);
    if (onShift.length === 0) {
      return this.empty(result, "NO_ENGINEERS_ON_SHIFT");
    }

    const skillsByUser = await this.skillsService.findSkillIdsByUser(onShift.map((e) => e.userId));
    const qualified = onShift.filter((entry) => {
      const held = skillsByUser.get(entry.userId);
      return requiredSkills.every((skill) => held?.has(skill.id));
    });

    if (qualified.length === 0) {
      result.uncoveredSkills = requiredSkills
        .filter((skill) => !onShift.some((e) => skillsByUser.get(e.userId)?.has(skill.id)))
        .map(({ id, name }) => ({ id, name }));
      return this.empty(result, "NO_QUALIFIED_ENGINEER");
    }

    const working = qualified.filter((e) => !e.isOnCall);
    const pool = working.length > 0 ? working : qualified;

    const workload = await this.incidentsService.countOpenOwnedBy(pool.map((e) => e.userId));
    result.candidates = pool
      .map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        email: entry.email,
        shiftLabel: entry.label,
        isOnCall: entry.isOnCall,
        openIncidentCount: workload.get(entry.userId) ?? 0,
        isCurrentOwner: incident.ownerUserId === entry.userId,
      }))
      .sort(
        (a, b) =>
          a.openIncidentCount - b.openIncidentCount || a.displayName.localeCompare(b.displayName),
      );
    return result;
  }

  /** One engineer can have overlapping live shifts at a site (e.g. a
   * working shift and an on-call window) — keep one entry each, preferring
   * the working shift. */
  private dedupeByEngineer(entries: RosterEntry[]): RosterEntry[] {
    const byUser = new Map<string, RosterEntry>();
    for (const entry of entries) {
      const existing = byUser.get(entry.userId);
      if (!existing || (existing.isOnCall && !entry.isOnCall)) {
        byUser.set(entry.userId, entry);
      }
    }
    return [...byUser.values()];
  }

  private empty(result: RoutingSuggestions, reason: RoutingEmptyReason): RoutingSuggestions {
    this.logger.log(`routing: no candidates for incident ${result.incidentId} (${reason})`);
    return { ...result, reason };
  }
}
