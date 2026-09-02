import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { VendorsService } from "./vendors.service";

// NOTE: RBAC (VENDOR_COORDINATOR / INFRASTRUCTURE_LEAD write, others read) +
// site/customer scope are enforced here once the auth module's guard lands
// (spec §4). Do not rely on the UI to hide vendor actions.
@ApiTags("vendors")
@Controller("vendors")
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  create(@Body() dto: CreateVendorDto) {
    return this.vendorsService.createVendor(dto);
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
