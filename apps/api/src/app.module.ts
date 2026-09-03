import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./common/prisma/prisma.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { SitesModule } from "./modules/sites/sites.module";
import { CmdbModule } from "./modules/cmdb/cmdb.module";
import { IncidentsModule } from "./modules/incidents/incidents.module";
import { SlaModule } from "./modules/sla/sla.module";
import { AlertsModule } from "./modules/alerts/alerts.module";
import { WorklogsModule } from "./modules/worklogs/worklogs.module";
import { VendorsModule } from "./modules/vendors/vendors.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { ChangesModule } from "./modules/changes/changes.module";
import { RisksModule } from "./modules/risks/risks.module";
import { MonitoringModule } from "./modules/monitoring/monitoring.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { AuditModule } from "./modules/audit/audit.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    // --- Dev A: Platform & Ticketing Core ---
    AuthModule,
    SitesModule,
    CmdbModule,
    IncidentsModule,
    WorklogsModule,
    SlaModule,
    AuditModule,
    ReportsModule,
    // --- Dev B: Integrations, Hardware & Governance ---
    AlertsModule,
    VendorsModule,
    ChangesModule,
    KnowledgeModule,
    RisksModule,
    MonitoringModule,
  ],
})
export class AppModule {}
