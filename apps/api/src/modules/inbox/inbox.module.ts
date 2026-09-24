import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: in-app notifications, meaning each user's bell list, its read state
 * and its retention purge. The incidents and sla modules call
 * InboxService.notifyUsers() next to their email enqueue.
 *
 * Must not own: deciding who gets told about what. The calling module picks
 * the recipients. Email delivery also stays with NotificationsPublisher and
 * the worker.
 *
 * The daily purge uses @Cron. ScheduleModule.forRoot() is registered once,
 * in SlaModule, and its scheduler picks up cron jobs app-wide.
 */
@Module({
  imports: [AuthModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
