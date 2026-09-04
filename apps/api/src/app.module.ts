import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { NotificationsModule } from "./common/notifications/notifications.module";
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
import { ProblemsModule } from "./modules/problems/problems.module";
import { RisksModule } from "./modules/risks/risks.module";
import { MonitoringModule } from "./modules/monitoring/monitoring.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { AuditModule } from "./modules/audit/audit.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Applies to every route app-wide (spec §18: "protect login, search,
    // event ingestion and webhook endpoints") — a single global default
    // covers Dev B's alerts ingestion/webhook endpoints too, without
    // touching their module code. Tighter per-route limits (e.g. login)
    // are layered on top via @Throttle(...).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    PrismaModule,
    NotificationsModule,
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
    ProblemsModule,
    KnowledgeModule,
    RisksModule,
    MonitoringModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
