import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  IssueCatalogKind,
  IssueCatalogOption,
  IssueTemplate,
  Priority,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import {
  CreateIssueCatalogOptionDto,
  CreateIssueTemplateDto,
  UpdateIssueCatalogOptionDto,
  UpdateIssueTemplateDto,
} from "./dto/issue-catalog.dto";
import { MAX_CC_EMAILS } from "./dto/update-cc-list.dto";

export interface CatalogOptionView {
  id: string;
  value: string;
  label: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ComponentView extends CatalogOptionView {
  subComponents: CatalogOptionView[];
}

/** Everything the "Report an issue" form needs to render its pick-lists. */
export interface IssueCatalog {
  issueTypes: CatalogOptionView[];
  priorities: CatalogOptionView[];
  severities: CatalogOptionView[];
  components: ComponentView[];
  tools: CatalogOptionView[];
  templates: IssueTemplate[];
  /** The support group a report lands in unless the reporter picks another. */
  defaultAssigneeGroupId: string | null;
}

/** The pick-list fields as they arrive on a create/update body. */
export interface IssueSelections {
  issueType?: string;
  priority?: Priority;
  severity?: string;
  component?: string;
  subComponent?: string;
  tool?: string;
}

const KIND_LABEL: Record<IssueCatalogKind, string> = {
  ISSUE_TYPE: "Issue type",
  PRIORITY: "Priority",
  SEVERITY: "Severity",
  COMPONENT: "Component",
  SUB_COMPONENT: "Sub component",
  TOOL: "Tool",
};

/**
 * Owns the "Report an issue" template configuration (spec: configuration
 * over hard-code): the pick-list catalog, one auto-draft template per
 * issue type, and the intake checks IncidentsService runs a client report
 * (or a staff edit of those fields) through. Lives in the incidents module
 * because every value here ends up on an Incident row; it never touches
 * incident state itself.
 *
 * Admin writes are audited; options and templates are retired with
 * `isActive = false`, never deleted, because incidents store the option's
 * `value` and history must keep resolving.
 */
@Injectable()
export class IssueReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // --- Catalog reads -----------------------------------------------------

  async getCatalog(): Promise<IssueCatalog> {
    const [options, templates, defaultGroup] = await Promise.all([
      this.prisma.issueCatalogOption.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      }),
      this.prisma.issueTemplate.findMany({
        where: { isActive: true, issueType: { isActive: true } },
        orderBy: { name: "asc" },
      }),
      this.prisma.supportGroup.findFirst({
        where: { isDefaultAssignee: true },
        select: { id: true },
      }),
    ]);
    const byKind = (kind: IssueCatalogKind) => options.filter((o) => o.kind === kind).map(toView);
    const components = byKind(IssueCatalogKind.COMPONENT).map((component) => ({
      ...component,
      subComponents: options
        .filter((o) => o.kind === IssueCatalogKind.SUB_COMPONENT && o.parentId === component.id)
        .map(toView),
    }));
    return {
      issueTypes: byKind(IssueCatalogKind.ISSUE_TYPE),
      priorities: byKind(IssueCatalogKind.PRIORITY),
      severities: byKind(IssueCatalogKind.SEVERITY),
      components,
      tools: byKind(IssueCatalogKind.TOOL),
      templates,
      defaultAssigneeGroupId: defaultGroup?.id ?? null,
    };
  }

  listOptions(includeInactive: boolean): Promise<IssueCatalogOption[]> {
    return this.prisma.issueCatalogOption.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    });
  }

  listTemplates(includeInactive: boolean): Promise<IssueTemplate[]> {
    return this.prisma.issueTemplate.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: "asc" },
    });
  }

  // --- Admin writes ------------------------------------------------------

  async createOption(dto: CreateIssueCatalogOptionDto, actor: ActorContext) {
    if (dto.kind === IssueCatalogKind.SUB_COMPONENT) {
      if (!dto.parentId) {
        throw new BadRequestException("A sub component needs the component it belongs under");
      }
      const parent = await this.prisma.issueCatalogOption.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent || parent.kind !== IssueCatalogKind.COMPONENT) {
        throw new BadRequestException("parentId must be a COMPONENT option");
      }
    } else if (dto.parentId) {
      throw new BadRequestException("Only a sub component can have a parent");
    }
    if (dto.kind === IssueCatalogKind.PRIORITY && !(dto.value in Priority)) {
      throw new BadRequestException(
        `A priority option must re-label one of ${Object.values(Priority).join(", ")}`,
      );
    }
    const existing = await this.prisma.issueCatalogOption.findUnique({
      where: { kind_value: { kind: dto.kind, value: dto.value } },
    });
    if (existing) {
      throw new ConflictException(`${KIND_LABEL[dto.kind]} "${dto.value}" already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const option = await tx.issueCatalogOption.create({
        data: {
          kind: dto.kind,
          value: dto.value,
          label: dto.label.trim(),
          parentId: dto.parentId,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "IssueCatalogOption",
          entityId: option.id,
          action: "CREATE",
          after: option,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return option;
    });
  }

  async updateOption(id: string, dto: UpdateIssueCatalogOptionDto, actor: ActorContext) {
    const before = await this.prisma.issueCatalogOption.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException(`Catalog option ${id} not found`);
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.issueCatalogOption.update({
        where: { id },
        data: {
          label: dto.label?.trim(),
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "IssueCatalogOption",
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

  async createTemplate(dto: CreateIssueTemplateDto, actor: ActorContext) {
    const issueType = await this.prisma.issueCatalogOption.findUnique({
      where: { id: dto.issueTypeId },
    });
    if (!issueType || issueType.kind !== IssueCatalogKind.ISSUE_TYPE) {
      throw new BadRequestException("issueTypeId must be an ISSUE_TYPE option");
    }
    const existing = await this.prisma.issueTemplate.findUnique({
      where: { issueTypeId: dto.issueTypeId },
    });
    if (existing) {
      throw new ConflictException(
        `"${issueType.label}" already has a template — edit that one instead`,
      );
    }
    await this.assertValidSelections({
      priority: dto.defaultPriority,
      severity: dto.defaultSeverity,
      component: dto.defaultComponent,
      subComponent: dto.defaultSubComponent,
      tool: dto.defaultTool,
    });
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.issueTemplate.create({
        data: {
          issueTypeId: dto.issueTypeId,
          name: dto.name.trim(),
          subjectDraft: dto.subjectDraft,
          descriptionDraft: dto.descriptionDraft,
          defaultPriority: dto.defaultPriority,
          defaultSeverity: dto.defaultSeverity,
          defaultComponent: dto.defaultComponent,
          defaultSubComponent: dto.defaultSubComponent,
          defaultTool: dto.defaultTool,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "IssueTemplate",
          entityId: template.id,
          action: "CREATE",
          after: template,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return template;
    });
  }

  async updateTemplate(id: string, dto: UpdateIssueTemplateDto, actor: ActorContext) {
    const before = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    // An omitted field keeps its value; "" clears it. The merged result is
    // what gets validated, so clearing the component also fails a sub
    // component that was left behind.
    const pick = (next: string | undefined, current: string | null) =>
      next === undefined ? current : next || null;
    const merged = {
      defaultPriority: pick(dto.defaultPriority, before.defaultPriority),
      defaultSeverity: pick(dto.defaultSeverity, before.defaultSeverity),
      defaultComponent: pick(dto.defaultComponent, before.defaultComponent),
      defaultSubComponent: pick(dto.defaultSubComponent, before.defaultSubComponent),
      defaultTool: pick(dto.defaultTool, before.defaultTool),
    };
    if (merged.defaultPriority && !(merged.defaultPriority in Priority)) {
      throw new BadRequestException(
        `defaultPriority must be one of ${Object.values(Priority).join(", ")}`,
      );
    }
    await this.assertValidSelections({
      severity: merged.defaultSeverity ?? undefined,
      component: merged.defaultComponent ?? undefined,
      subComponent: merged.defaultSubComponent ?? undefined,
      tool: merged.defaultTool ?? undefined,
    });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.issueTemplate.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          subjectDraft: pick(dto.subjectDraft, before.subjectDraft),
          descriptionDraft: dto.descriptionDraft,
          ...merged,
          defaultPriority: merged.defaultPriority as Priority | null,
          isActive: dto.isActive,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "IssueTemplate",
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

  // --- Intake checks (used by IncidentsService) ---------------------------

  /**
   * Every supplied pick-list value must be an *active* option of its kind,
   * and a sub component must sit under the supplied component. Priority is
   * the fixed enum (already validated by the DTO) so it isn't looked up.
   */
  async assertValidSelections(
    sel: IssueSelections,
    opts: { requireIssueType?: boolean } = {},
  ): Promise<void> {
    if (opts.requireIssueType && !sel.issueType) {
      throw new BadRequestException("Issue type is required");
    }
    const wanted: { kind: IssueCatalogKind; value: string }[] = [];
    if (sel.issueType) wanted.push({ kind: IssueCatalogKind.ISSUE_TYPE, value: sel.issueType });
    if (sel.severity) wanted.push({ kind: IssueCatalogKind.SEVERITY, value: sel.severity });
    if (sel.component) wanted.push({ kind: IssueCatalogKind.COMPONENT, value: sel.component });
    if (sel.subComponent)
      wanted.push({ kind: IssueCatalogKind.SUB_COMPONENT, value: sel.subComponent });
    if (sel.tool) wanted.push({ kind: IssueCatalogKind.TOOL, value: sel.tool });
    if (wanted.length === 0) {
      return;
    }
    const found = await this.prisma.issueCatalogOption.findMany({
      where: { isActive: true, OR: wanted },
    });
    const lookup = (kind: IssueCatalogKind, value: string) =>
      found.find((o) => o.kind === kind && o.value === value);
    for (const w of wanted) {
      if (!lookup(w.kind, w.value)) {
        throw new BadRequestException(
          `${KIND_LABEL[w.kind]} "${w.value}" is not an available option`,
        );
      }
    }
    if (sel.subComponent) {
      if (!sel.component) {
        throw new BadRequestException("A sub component needs its component");
      }
      const component = lookup(IssueCatalogKind.COMPONENT, sel.component);
      const sub = lookup(IssueCatalogKind.SUB_COMPONENT, sel.subComponent);
      if (component && sub && sub.parentId !== component.id) {
        throw new BadRequestException(
          `Sub component "${sub.label}" does not belong to component "${component.label}"`,
        );
      }
    }
  }

  /**
   * Assignee Group / Assignee as submitted on the form. No group picked →
   * the default group (Service Desk), if one is flagged. An assignee must be
   * an active staff member of that group; a reporter can't route a ticket
   * to an arbitrary user.
   */
  async resolveAssignment(
    ownerGroupId: string | undefined,
    ownerUserId: string | undefined,
  ): Promise<{ ownerGroupId: string | null; ownerUserId: string | null }> {
    const group = ownerGroupId
      ? await this.prisma.supportGroup.findUnique({ where: { id: ownerGroupId } })
      : await this.prisma.supportGroup.findFirst({ where: { isDefaultAssignee: true } });
    if (ownerGroupId && !group) {
      throw new BadRequestException("Unknown assignee group");
    }
    if (!ownerUserId) {
      return { ownerGroupId: group?.id ?? null, ownerUserId: null };
    }
    const user = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (!user || !user.isActive || user.role === UserRole.CLIENT_MANAGER_VIEWER) {
      throw new BadRequestException("Assignee must be an active staff member");
    }
    if (!group) {
      throw new BadRequestException("Pick an assignee group before an assignee");
    }
    const membership = await this.prisma.supportGroupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
    });
    if (!membership) {
      throw new BadRequestException(`${user.displayName} is not a member of ${group.name}`);
    }
    return { ownerGroupId: group.id, ownerUserId: user.id };
  }

  /**
   * "Ref Bug ID": the ticket this one duplicates or is blocked by. Accepts
   * the full number (INC-000123, any case) or just the digits; the only
   * rule is that the ticket exists — the number format itself is whatever
   * the sequence (or a seed) produced.
   */
  async resolveRefIncidentNo(raw: string): Promise<string> {
    const trimmed = raw.trim().toUpperCase();
    const incidentNo = /^\d+$/.test(trimmed) ? `INC-${trimmed.padStart(6, "0")}` : trimmed;
    const ref = await this.prisma.incident.findUnique({
      where: { incidentNo },
      select: { incidentNo: true },
    });
    if (!ref) {
      throw new BadRequestException(`No ticket ${incidentNo} exists`);
    }
    return ref.incidentNo;
  }

  /** Lower-cased, trimmed, de-duplicated, capped. */
  normalizeCcEmails(emails: string[] | undefined): string[] {
    const seen = new Set<string>();
    for (const raw of emails ?? []) {
      const email = raw.trim().toLowerCase();
      if (email) seen.add(email);
    }
    if (seen.size > MAX_CC_EMAILS) {
      throw new BadRequestException(`CC list can hold at most ${MAX_CC_EMAILS} addresses`);
    }
    return [...seen];
  }
}

function toView(o: IssueCatalogOption): CatalogOptionView {
  return {
    id: o.id,
    value: o.value,
    label: o.label,
    parentId: o.parentId,
    sortOrder: o.sortOrder,
    isActive: o.isActive,
  };
}
