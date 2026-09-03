import { Global, Module } from "@nestjs/common";
import { NotificationsPublisher } from "./notifications.publisher";

/**
 * @Global (like PrismaModule / AuditModule) so any module can inject
 * NotificationsPublisher without importing this explicitly. Owner: Dev B — the
 * worker (also Dev B) consumes the queue.
 */
@Global()
@Module({
  providers: [NotificationsPublisher],
  exports: [NotificationsPublisher],
})
export class NotificationsModule {}
