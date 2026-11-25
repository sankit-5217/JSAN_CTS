import { Global, Module } from "@nestjs/common";
import { JobLockService } from "./job-lock.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, JobLockService],
  exports: [PrismaService, JobLockService],
})
export class PrismaModule {}
