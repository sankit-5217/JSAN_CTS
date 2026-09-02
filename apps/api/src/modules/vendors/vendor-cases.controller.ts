import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AddVendorCaseUpdateDto } from "./dto/add-vendor-case-update.dto";
import { CreateVendorCaseDto } from "./dto/create-vendor-case.dto";
import { QueryVendorCasesDto } from "./dto/query-vendor-cases.dto";
import { UpdateVendorCaseDto } from "./dto/update-vendor-case.dto";
import { VendorsService } from "./vendors.service";

// NOTE: RBAC + site/customer scope enforced here once the auth guard lands
// (spec §4). `dispatchStatus` and case closure are backend state rules — the
// PATCH body is validated against the current state server-side.
@ApiTags("vendor-cases")
@Controller("vendor-cases")
export class VendorCasesController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @ApiOperation({ summary: "Open a vendor case (optionally linked to an incident and CI)" })
  open(@Body() dto: CreateVendorCaseDto) {
    return this.vendorsService.openCase(dto);
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
  @ApiOperation({ summary: "Advance dispatch lifecycle, set ETA/part/warranty, ack or close" })
  update(@Param("id") id: string, @Body() dto: UpdateVendorCaseDto) {
    return this.vendorsService.updateCase(id, dto);
  }

  @Post(":id/updates")
  @ApiOperation({ summary: "Append an immutable note to the vendor case history" })
  addUpdate(@Param("id") id: string, @Body() dto: AddVendorCaseUpdateDto) {
    return this.vendorsService.addUpdate(id, dto);
  }
}
