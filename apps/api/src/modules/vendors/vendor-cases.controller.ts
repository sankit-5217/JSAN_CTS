import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AddVendorCaseUpdateDto } from "./dto/add-vendor-case-update.dto";
import { CreateVendorCaseDto } from "./dto/create-vendor-case.dto";
import { QueryVendorCasesDto } from "./dto/query-vendor-cases.dto";
import { UpdateVendorCaseDto } from "./dto/update-vendor-case.dto";
import { VENDOR_WRITE_ROLES } from "./vendors.controller";
import { VendorsService } from "./vendors.service";

// `dispatchStatus` and case closure are backend state rules — the PATCH body is
// validated against the current state server-side (spec §4, §12).
@ApiTags("vendor-cases")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("vendor-cases")
export class VendorCasesController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @Roles(...VENDOR_WRITE_ROLES)
  @ApiOperation({ summary: "Open a vendor case (optionally linked to an incident and CI)" })
  open(
    @Body() dto: CreateVendorCaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.vendorsService.openCase(dto, { actorId: user.id, correlationId });
  }

  @Get()
  findAll(@Query() query: QueryVendorCasesDto) {
    return this.vendorsService.listCases(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.vendorsService.getCase(id);
  }

  @Patch(":id")
  @Roles(...VENDOR_WRITE_ROLES)
  @ApiOperation({ summary: "Advance dispatch lifecycle, set ETA/part/warranty, ack or close" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVendorCaseDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.vendorsService.updateCase(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/updates")
  @Roles(...VENDOR_WRITE_ROLES)
  @ApiOperation({ summary: "Append an immutable note to the vendor case history" })
  addUpdate(
    @Param("id") id: string,
    @Body() dto: AddVendorCaseUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.vendorsService.addUpdate(id, dto, { actorId: user.id, correlationId });
  }
}
