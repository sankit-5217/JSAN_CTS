import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import type { DispatchStatus } from "./vendors.constants";
import { canTransitionDispatch } from "./vendors.dispatch";
import { AddVendorCaseUpdateDto } from "./dto/add-vendor-case-update.dto";
import { CreateVendorCaseDto } from "./dto/create-vendor-case.dto";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { QueryVendorCasesDto } from "./dto/query-vendor-cases.dto";
import { UpdateVendorCaseDto } from "./dto/update-vendor-case.dto";

/**
 * Owns: vendors, vendor cases, RMA dispatch lifecycle, append-only vendor
 * updates (spec §10.13, §12). Must not own: monitoring metrics, and must not
 * mutate incident state — a case only *links* to an incident by id.
 */
@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsPublisher,
  ) {}

  // --- vendors -------------------------------------------------------------

  async createVendor(dto: CreateVendorDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({ data: { name: dto.name, type: dto.type } });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "vendor",
          entityId: vendor.id,
          action: "VENDOR_REGISTERED",
          after: vendor,
        },
        tx,
      );
      return vendor;
    });
  }

  listVendors() {
    return this.prisma.vendor.findMany({ orderBy: { name: "asc" } });
  }

  async getVendor(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }
    return vendor;
  }

  // --- vendor cases ------------------------------------------------------------

  async openCase(dto: CreateVendorCaseDto, actor: ActorContext) {
    await this.getVendor(dto.vendorId);
    if (dto.linkedIncidentId) {
      await this.assertIncidentExists(dto.linkedIncidentId);
    }
    if (dto.ciId) {
      await this.assertCiExists(dto.ciId);
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorCase.create({
        data: {
          vendorCaseNo: dto.vendorCaseNo,
          vendorId: dto.vendorId,
          linkedIncidentId: dto.linkedIncidentId ?? null,
          ciId: dto.ciId ?? null,
          warrantyStatus: dto.warrantyStatus ?? "UNKNOWN",
          rmaRequired: dto.rmaRequired ?? false,
          replacementPart: dto.replacementPart ?? null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "vendor_case",
          entityId: created.id,
          action: "VENDOR_CASE_OPENED",
          after: created,
        },
        tx,
      );
      return created;
    });
  }

  listCases(query: QueryVendorCasesDto) {
    return this.prisma.vendorCase.findMany({
      where: {
        ...(query.vendorId ? { vendorId: query.vendorId } : {}),
        ...(query.linkedIncidentId ? { linkedIncidentId: query.linkedIncidentId } : {}),
        ...(query.dispatchStatus ? { dispatchStatus: query.dispatchStatus } : {}),
        ...(query.status === "open" ? { closedAt: null } : {}),
        ...(query.status === "closed" ? { NOT: { closedAt: null } } : {}),
      },
      orderBy: { openedAt: "desc" },
      take: query.limit ?? 50,
    });
  }

  async getCase(id: string) {
    const vendorCase = await this.prisma.vendorCase.findUnique({
      where: { id },
      include: { updates: { orderBy: { createdAt: "asc" } } },
    });
    if (!vendorCase) {
      throw new NotFoundException(`Vendor case ${id} not found`);
    }
    return vendorCase;
  }

  async updateCase(id: string, dto: UpdateVendorCaseDto, actor: ActorContext) {
    const current = await this.getCase(id);
    if (current.closedAt) {
      throw new ConflictException(`Vendor case ${id} is closed`);
    }

    if (
      dto.dispatchStatus &&
      !canTransitionDispatch(current.dispatchStatus as DispatchStatus | null, dto.dispatchStatus)
    ) {
      throw new BadRequestException(
        `Invalid dispatch transition ${current.dispatchStatus ?? "(none)"} -> ${dto.dispatchStatus}`,
      );
    }

    // omit the notes thread from the audit snapshot — it is its own append-only log
    const caseBefore = { ...current, updates: undefined };
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vendorCase.update({
        where: { id },
        data: {
          ...(dto.dispatchStatus ? { dispatchStatus: dto.dispatchStatus } : {}),
          ...(dto.dispatchStatus && !current.rmaRequired ? { rmaRequired: true } : {}),
          ...(dto.replacementPart !== undefined ? { replacementPart: dto.replacementPart } : {}),
          ...(dto.warrantyStatus ? { warrantyStatus: dto.warrantyStatus } : {}),
          ...(dto.vendorEta ? { vendorEta: new Date(dto.vendorEta) } : {}),
          ...(dto.acknowledged && !current.acknowledgedAt ? { acknowledgedAt: new Date() } : {}),
          ...(dto.closeOutcome ? { closedAt: new Date(), outcome: dto.closeOutcome } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "vendor_case",
          entityId: id,
          action: dto.closeOutcome ? "VENDOR_CASE_CLOSED" : "VENDOR_CASE_UPDATED",
          before: caseBefore,
          after: updated,
        },
        tx,
      );
      return updated;
    });
  }

  async addUpdate(id: string, dto: AddVendorCaseUpdateDto, actor: ActorContext) {
    const vendorCase = await this.getCase(id);
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorCaseUpdate.create({
        data: { vendorCaseId: id, note: dto.note },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "vendor_case",
          entityId: id,
          action: "VENDOR_CASE_NOTE_ADDED",
          after: { updateId: created.id, note: created.note },
        },
        tx,
      );
      return created;
    });

    await this.notifyLinkedIncidentOwner(vendorCase, dto.note);
    return note;
  }

  /** Best-effort: if the case is linked to an incident, tell that incident's
   *  owner a vendor update landed. Fully swallowed — never blocks the note. */
  private async notifyLinkedIncidentOwner(
    vendorCase: { id: string; vendorCaseNo: string; linkedIncidentId: string | null },
    note: string,
  ): Promise<void> {
    try {
      if (!vendorCase.linkedIncidentId) {
        return;
      }
      const incident = await this.prisma.incident.findUnique({
        where: { id: vendorCase.linkedIncidentId },
      });
      if (!incident?.ownerUserId) {
        return;
      }
      const owner = await this.prisma.user.findUnique({ where: { id: incident.ownerUserId } });
      if (!owner?.email) {
        return;
      }
      await this.notifications.enqueue({
        event: {
          kind: "VENDOR_CASE_UPDATE",
          entity: {
            key: `VC-${vendorCase.vendorCaseNo}`,
            title: `Vendor case for ${incident.incidentNo} — ${incident.shortDescription}`.slice(
              0,
              140,
            ),
          },
          note,
        },
        recipients: { to: [{ name: owner.displayName, email: owner.email }] },
      });
    } catch (err) {
      this.logger.warn(
        `vendor case ${vendorCase.id} update notification skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async assertIncidentExists(id: string) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }
  }

  private async assertCiExists(id: string) {
    const ci = await this.prisma.configurationItem.findUnique({ where: { id } });
    if (!ci) {
      throw new NotFoundException(`Configuration item ${id} not found`);
    }
  }
}
