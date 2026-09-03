import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigurationItem, Prisma } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateCiDto } from "./dto/create-ci.dto";
import { CreateRackDto } from "./dto/create-rack.dto";
import { ListCisQueryDto } from "./dto/list-cis-query.dto";
import { UpdateCiDto } from "./dto/update-ci.dto";

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Owns: Configuration Items, components, relationships, lifecycle (spec §9, §12).
 * Must not own ticket SLA state.
 *
 * Site scope note: unlike SitesController, CI/Rack detail routes identify
 * the resource by its *own* id, not a site id, so SiteScopeGuard (built
 * for `/sites/:id`) doesn't apply directly here. `assertSiteAccess()`
 * below is the explicit equivalent — load the resource, resolve its
 * siteId, check it. List endpoints still filter via
 * AuthzService.getAccessibleSiteIds() exactly like SitesService.
 *
 * TODO: managementAddress is spec-restricted ("never expose to customer
 * viewer", §9.1) but this module doesn't yet redact it per-role in read
 * responses — no customer-facing viewer role consumes this API yet, so
 * deferred rather than half-built.
 */
@Injectable()
export class CmdbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authzService: AuthzService,
  ) {}

  private async assertSiteAccess(user: AuthenticatedUser, siteId: string): Promise<void> {
    const allowed = await this.authzService.canAccessSite(user, siteId);
    if (!allowed) {
      throw new ForbiddenException("You do not have access to this site");
    }
  }

  // --- Configuration Items -----------------------------------------------

  async findAll(
    query: ListCisQueryDto,
    accessibleSiteIds?: string[] | null,
  ): Promise<Paginated<ConfigurationItem>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // Intersect the caller's site scope with an explicit ?siteId filter,
    // rather than letting an explicit filter bypass scope.
    let siteFilter: string[] | undefined;
    if (accessibleSiteIds) {
      siteFilter =
        query.siteId && accessibleSiteIds.includes(query.siteId)
          ? [query.siteId]
          : accessibleSiteIds;
    } else if (query.siteId) {
      siteFilter = [query.siteId];
    }

    const where: Prisma.ConfigurationItemWhereInput = {
      siteId: siteFilter ? { in: siteFilter } : undefined,
      ciType: query.ciType,
      criticality: query.criticality,
      managedBy: query.managedBy,
      lifecycleStatus: query.lifecycleStatus,
      OR: query.q
        ? [
            { ciCode: { contains: query.q, mode: "insensitive" } },
            { name: { contains: query.q, mode: "insensitive" } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.configurationItem.findMany({
        where,
        orderBy: { ciCode: "asc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.configurationItem.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findOne(id: string) {
    const ci = await this.prisma.configurationItem.findUnique({ where: { id } });
    if (!ci) {
      throw new NotFoundException(`Configuration Item ${id} not found`);
    }
    return ci;
  }

  async findOneScoped(id: string, user: AuthenticatedUser) {
    const ci = await this.findOne(id);
    await this.assertSiteAccess(user, ci.siteId);
    return ci;
  }

  async create(dto: CreateCiDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const ci = await tx.configurationItem.create({
        data: {
          ciCode: dto.ciCode,
          siteId: dto.siteId,
          rackId: dto.rackId,
          ciType: dto.ciType,
          name: dto.name,
          manufacturer: dto.manufacturer,
          model: dto.model,
          serialOrServiceTag: dto.serialOrServiceTag,
          managementAddress: dto.managementAddress,
          ownerGroupId: dto.ownerGroupId,
          managedBy: dto.managedBy,
          criticality: dto.criticality,
          lifecycleStatus: dto.lifecycleStatus ?? "ACTIVE",
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "ConfigurationItem",
          entityId: ci.id,
          action: "CREATE",
          after: ci,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return ci;
    });
  }

  async update(id: string, dto: UpdateCiDto, user: AuthenticatedUser, actor: ActorContext) {
    const before = await this.findOneScoped(id, user);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.configurationItem.update({
        where: { id },
        data: {
          rackId: dto.rackId,
          name: dto.name,
          manufacturer: dto.manufacturer,
          model: dto.model,
          serialOrServiceTag: dto.serialOrServiceTag,
          managementAddress: dto.managementAddress,
          ownerGroupId: dto.ownerGroupId,
          criticality: dto.criticality,
          lifecycleStatus: dto.lifecycleStatus,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "ConfigurationItem",
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

  // --- Racks ---------------------------------------------------------

  async listRacks(accessibleSiteIds?: string[] | null) {
    return this.prisma.rack.findMany({
      where: accessibleSiteIds ? { siteId: { in: accessibleSiteIds } } : undefined,
      orderBy: [{ siteId: "asc" }, { rackCode: "asc" }],
    });
  }

  async findRackScoped(id: string, user: AuthenticatedUser) {
    const rack = await this.prisma.rack.findUnique({ where: { id } });
    if (!rack) {
      throw new NotFoundException(`Rack ${id} not found`);
    }
    await this.assertSiteAccess(user, rack.siteId);
    return rack;
  }

  async createRack(dto: CreateRackDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const rack = await tx.rack.create({
        data: {
          siteId: dto.siteId,
          rackCode: dto.rackCode,
          name: dto.name,
          location: dto.location,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Rack",
          entityId: rack.id,
          action: "CREATE",
          after: rack,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return rack;
    });
  }
}
