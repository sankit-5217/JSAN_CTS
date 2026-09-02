import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SitesController } from "./sites.controller";
import { SitesService } from "./sites.service";
import { SupportGroupsController } from "./support-groups.controller";

@Module({
  imports: [AuthModule],
  controllers: [SitesController, SupportGroupsController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
