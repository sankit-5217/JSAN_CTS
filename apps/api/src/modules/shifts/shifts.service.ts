import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EngineerShift, Prisma } from "@prisma/client";
import { isEngineerRole } from "../auth/engineer-roles";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { QueryShiftsDto } from "./dto/query-shifts.dto";
import { UpdateShiftDto } from "./dto/update-shift.dto";
import { isShiftActiveAt } from "./shift.util";

export interface RosterEntry {
  shiftId: string;
  label: string;
  isOnCall: boolean;
  siteId: string;
  siteCode: string;
  userId: string;
  displayName: string;
  email: string;
}

export interface LiveRoster {
  asOf: string;
  working: RosterEntry[];
  onCall: RosterEntry[];
}

type ShiftWithContext = Prisma.EngineerShiftGetPayload<{ include: { user: true; site: true } }>;

/**
 * Owns: recurring weekly engineer duty windows (EngineerShift) and the
 * live "who's on now" roster computed from them. Must not own: worklogs
 * (actual clocked time / corrections — worklogs module's job) or on-call
 * site contacts for SLA escalation (SiteContact.isOnCall — sla module's
 * job; deliberately not wired together, see shifts.module.ts).
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private buildWhere(
    query: QueryShiftsDto,
    accessibleSiteIds: string[] | null | undefined,
  ): Prisma.EngineerShiftWhereInput {
    let siteFilter: string[] | undefined;
    if (accessibleSiteIds) {
      siteFilter =
        query.siteId && accessibleSiteIds.includes(query.siteId)
          ? [query.siteId]
          : accessibleSiteIds;
    } else if (query.siteId) {
      siteFilter = [query.siteId];
    }
    return {
      siteId: siteFilter ? { in: siteFilter } : undefined,
      userId: query.userId,
    };
  }

  async findAll(
    query: QueryShiftsDto,
    accessibleSiteIds: string[] | null | undefined,
  ): Promise<EngineerShift[]> {
    return this.prisma.engineerShift.findMany({
      where: this.buildWhere(query, accessibleSiteIds),
      orderBy: [{ siteId: "asc" }, { startTime: "asc" }],
    });
  }

  async findOne(id: string): Promise<EngineerShift> {
    const shift = await this.prisma.engineerShift.findUnique({ where: { id } });
    if (!shift) {
      throw new NotFoundException(`Shift ${id} not found`);
    }
    return shift;
  }

  private assertUsableWindow(startTime: string, endTime: string): void {
    if (startTime === endTime) {
      throw new BadRequestException(
        "startTime and endTime cannot be equal — a shift needs a real duration",
      );
    }
  }

  async create(dto: CreateShiftDto, actor: ActorContext): Promise<EngineerShift> {
    this.assertUsableWindow(dto.startTime, dto.endTime);
    const [user, site] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: dto.userId } }),
      this.prisma.site.findUnique({ where: { id: dto.siteId } }),
    ]);
    if (!user) {
      throw new BadRequestException(`User ${dto.userId} not found`);
    }
    if (!isEngineerRole(user.role)) {
      throw new BadRequestException(
        `${user.displayName} isn't an engineer; only Site Engineers and Infrastructure Leads work shifts`,
      );
    }
    if (!site) {
      throw new BadRequestException(`Site ${dto.siteId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.engineerShift.create({
        data: {
          userId: dto.userId,
          siteId: dto.siteId,
          label: dto.label,
          daysOfWeek: dto.daysOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isOnCall: dto.isOnCall ?? false,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "EngineerShift",
          entityId: shift.id,
          action: "CREATE",
          after: shift,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return shift;
    });
  }

  async update(id: string, dto: UpdateShiftDto, actor: ActorContext): Promise<EngineerShift> {
    const before = await this.findOne(id);
    this.assertUsableWindow(dto.startTime ?? before.startTime, dto.endTime ?? before.endTime);
    if (dto.isActive === true && !before.isActive) {
      // Same engineer-only rule as create: a shift disabled so its holder
      // could move to a non-engineer role must not come back to life.
      const user = await this.prisma.user.findUnique({
        where: { id: before.userId },
        select: { displayName: true, role: true },
      });
      if (!user || !isEngineerRole(user.role)) {
        throw new BadRequestException(
          `${user?.displayName ?? "This user"} isn't an engineer; only Site Engineers and Infrastructure Leads work shifts`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.engineerShift.update({
        where: { id },
        data: {
          label: dto.label,
          daysOfWeek: dto.daysOfWeek,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isOnCall: dto.isOnCall,
          isActive: dto.isActive,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "EngineerShift",
          entityId: id,
          action: "UPDATE",
          before,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return after;
    });
  }

  /**
   * Who's covering right now, split into normal working shifts and on-call
   * windows — computed purely from the active shift schedule against the
   * current time in each shift's own site timezone (no activity/presence
   * signal folded in; see shifts module design notes). `now` is injectable
   * for tests; defaults to the real clock.
   */
  async getLiveRoster(
    query: QueryShiftsDto,
    accessibleSiteIds: string[] | null | undefined,
    now: Date = new Date(),
  ): Promise<LiveRoster> {
    const shifts: ShiftWithContext[] = await this.prisma.engineerShift.findMany({
      where: { ...this.buildWhere(query, accessibleSiteIds), isActive: true },
      include: { user: true, site: true },
    });

    const working: RosterEntry[] = [];
    const onCall: RosterEntry[] = [];
    for (const shift of shifts) {
      if (!shift.user.isActive) {
        continue;
      }
      if (!isShiftActiveAt(shift, shift.site.timezone, now)) {
        continue;
      }
      const entry: RosterEntry = {
        shiftId: shift.id,
        label: shift.label,
        isOnCall: shift.isOnCall,
        siteId: shift.siteId,
        siteCode: shift.site.code,
        userId: shift.userId,
        displayName: shift.user.displayName,
        email: shift.user.email,
      };
      (shift.isOnCall ? onCall : working).push(entry);
    }

    return { asOf: now.toISOString(), working, onCall };
  }
}
