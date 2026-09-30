import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import { InboxService } from "./inbox.service";

// Every role has a bell. The routes only ever touch the caller's own rows,
// so there's nothing further to gate by role or site.
const ALL_ROLES = Object.values(UserRole);

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("notifications")
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get()
  @ApiOperation({ summary: "My in-app notifications, newest first, with my unread count" })
  list(@Query() query: ListNotificationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inboxService.listForUser(user, query.limit);
  }

  @Post("read-all")
  @HttpCode(200)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: "Mark all my notifications read" })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.inboxService.markAllRead(user);
  }

  @Post(":id/read")
  @HttpCode(200)
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: "Mark one of my notifications read" })
  markRead(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inboxService.markRead(id, user);
  }
}
