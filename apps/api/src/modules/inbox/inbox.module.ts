import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { NotificationSoundRulesController } from "./notification-sound-rules.controller";
import { NotificationSoundRulesService } from "./notification-sound-rules.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: in-app notifications, meaning each user's bell list, its read state
 * and its retention purge, plus the notification_sound_rules config that
 * stamps each notification with the sound tier the ops console plays. The
 * incidents, sla, routing and alerts modules call InboxService.notifyUsers()
 * next to their email enqueue.
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
  controllers: [InboxController, NotificationSoundRulesController],
  providers: [InboxService, NotificationSoundRulesService],
  exports: [InboxService],
})
export class InboxModule {}
