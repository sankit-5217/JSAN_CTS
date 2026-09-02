import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SitesService } from "./sites.service";
import { CreateSiteDto } from "./dto/create-site.dto";

// NOTE: authorization guards (RBAC + site scope) are wired here once the
// auth module's guard is implemented. Every endpoint must enforce it
// server-side per the spec's "RBAC rule" (§4) — do not rely on the UI.
@ApiTags("sites")
@Controller("sites")
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  findAll() {
    return this.sitesService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.sitesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSiteDto) {
    return this.sitesService.create(dto);
  }
}
