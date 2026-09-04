import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { AuthzService } from "../auth/authz.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateIncidentCommentDto } from "./dto/create-incident-comment.dto";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { ListIncidentsQueryDto } from "./dto/list-incidents-query.dto";
import { TransitionIncidentDto } from "./dto/transition-incident.dto";
import { UpdateIncidentDto } from "./dto/update-incident.dto";
import { IncidentsService, UploadedAttachmentFile } from "./incidents.service";

// Wider than CMDB's write set by exactly SERVICE_DESK_NOC — spec §4 gives
// that role "Triage, acknowledge, route, update incidents" as its primary
// responsibility.
export const INCIDENT_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.SITE_ENGINEER,
  UserRole.SERVICE_DESK_NOC,
] as const;

@ApiTags("incidents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("incidents")
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  async findAll(@Query() query: ListIncidentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.incidentsService.findAll(query, accessibleSiteIds);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.findOneScoped(id, user);
  }

  @Post()
  @Roles(...INCIDENT_WRITE_ROLES)
  create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.incidentsService.create(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...INCIDENT_WRITE_ROLES)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.incidentsService.update(id, dto, user, { actorId: user.id, correlationId });
  }

  @Post(":id/transition")
  @Roles(...INCIDENT_WRITE_ROLES)
  transition(
    @Param("id") id: string,
    @Body() dto: TransitionIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.incidentsService.createTransition(
      id,
      dto,
      { actorId: user.id, correlationId },
      user,
    );
  }

  @Get(":id/comments")
  listComments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.listComments(id, user);
  }

  @Post(":id/comments")
  @Roles(...INCIDENT_WRITE_ROLES)
  createComment(
    @Param("id") id: string,
    @Body() dto: CreateIncidentCommentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.incidentsService.createComment(id, dto, { actorId: user.id, correlationId }, user);
  }

  @Get(":id/events")
  listEvents(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.listEvents(id, user);
  }

  @Get(":id/sla")
  findSlaState(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.findSlaState(id, user);
  }

  @Post(":id/attachments")
  @Roles(...INCIDENT_WRITE_ROLES)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  uploadAttachment(
    @Param("id") id: string,
    @UploadedFile() file: UploadedAttachmentFile,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.incidentsService.uploadAttachment(
      id,
      file,
      { actorId: user.id, correlationId },
      user,
    );
  }

  @Get(":id/attachments")
  listAttachments(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.incidentsService.listAttachments(id, user);
  }

  @Get(":id/attachments/:attachmentId/download")
  getAttachmentDownloadUrl(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.incidentsService.getAttachmentDownloadUrl(id, attachmentId, user);
  }
}
