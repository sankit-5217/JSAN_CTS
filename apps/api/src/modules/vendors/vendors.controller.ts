import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { VendorsService } from "./vendors.service";

// Vendor + case writes: the vendor coordination roles (spec §4). Vendors are
// cross-site reference data, so no SiteScopeGuard; reads are open to any
// authenticated user.
export const VENDOR_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
] as const;

@ApiTags("vendors")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("vendors")
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @Roles(...VENDOR_WRITE_ROLES)
  create(
    @Body() dto: CreateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.vendorsService.createVendor(dto, { actorId: user.id, correlationId });
  }

  @Get()
  findAll() {
    return this.vendorsService.listVendors();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.vendorsService.getVendor(id);
  }
}
