import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SendingMailController, MailWorkerGuard } from "./sending-mail.controller";
import { SendingMailService } from "./sending-mail.service";
@Module({
  imports: [AuthModule],
  controllers: [SendingMailController],
  providers: [SendingMailService, MailWorkerGuard],
})
export class SendingMailModule {}
