import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreateSiteDto } from "./dto/create-site.dto";

/**
 * Owns: sites, timezone, contacts, support calendars (spec §12).
 * Must not own hardware telemetry or ticket SLA state.
 */
@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.site.findMany({ orderBy: { code: "asc" } });
  }

  async findOne(id: string) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) {
      throw new NotFoundException(`Site ${id} not found`);
    }
    return site;
  }

  create(dto: CreateSiteDto) {
    return this.prisma.site.create({
      data: {
        code: dto.code,
        name: dto.name,
        timezone: dto.timezone,
        is247: dto.is247 ?? false,
      },
    });
  }
}
