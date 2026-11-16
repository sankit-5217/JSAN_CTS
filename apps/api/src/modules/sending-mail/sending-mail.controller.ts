import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { timingSafeEqual } from "crypto";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { SendingMailService } from "./sending-mail.service";

class SmtpDto {
  @IsIn(["yahoo", "icloud", "zoho"]) provider!: string;
  @IsString() @MinLength(1) @MaxLength(1024) password!: string;
}
class MailDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  to!: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  cc?: string[];
  @IsString() @MaxLength(1000) subject!: string;
  @IsString() @MaxLength(200000) text!: string;
  @IsString() @MaxLength(500000) html!: string;
  @IsObject() headers!: Record<string, string>;
}
class DeliveryDto {
  @IsUUID() userId!: string;
  @IsDefined() @ValidateNested() @Type(() => MailDto) email!: MailDto;
}
@Injectable()
export class MailWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const supplied = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
      .headers["x-mail-worker-key"];
    const expected = process.env.MAIL_WORKER_KEY;
    if (!expected || expected.length < 32 || typeof supplied !== "string")
      throw new UnauthorizedException();
    const left = Buffer.from(supplied),
      right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new UnauthorizedException();
    return true;
  }
}

@ApiTags("Sending mail")
@Controller("sending-mail")
export class SendingMailController {
  constructor(private readonly service: SendingMailService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get your connected sending account (no credentials)" })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user.id);
  }

  @Post("connect/:provider")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Authorize your own Gmail or Microsoft mailbox" })
  connect(@CurrentUser() user: AuthenticatedUser, @Param("provider") provider: string) {
    return this.service.connect(user.id, provider);
  }

  @Post("smtp")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Verify and connect your own SMTP mailbox using an app password" })
  async smtp(@CurrentUser() user: AuthenticatedUser, @Body() body: SmtpDto) {
    await this.service.connectSmtp(user.id, body.provider, body.password);
    return { connected: true };
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove saved mailbox credentials and pending authorizations" })
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.service.disconnect(user.id);
    return { connected: false };
  }

  @Get("callback/:provider")
  @ApiOperation({ summary: "Single-use, expiring OAuth callback" })
  async callback(
    @Param("provider") provider: string,
    @Query("state") state: string,
    @Query("code") code: string | undefined,
    @Res() response: Response,
  ) {
    let result = "connected";
    try {
      if (!state || state.length > 256) throw new Error("Invalid state");
      await this.service.callback(provider, state, code);
    } catch {
      result = "failed";
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    const base = (process.env.WEB_APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
    return response.redirect(`${base}/account/email?result=${result}`);
  }

  @Post("deliver")
  @UseGuards(MailWorkerGuard)
  @ApiOperation({ summary: "Worker-only delivery using an actor's authorized mailbox" })
  async deliver(@Body() body: DeliveryDto) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.email.headers)) {
      if (
        /^(X-OpsDesk-[a-z-]+|In-Reply-To|References)$/i.test(key) &&
        typeof value === "string" &&
        value.length <= 2000 &&
        !/[\r\n]/.test(value)
      )
        headers[key] = value;
    }
    await this.service.send(body.userId, { ...body.email, headers });
    return { sent: true };
  }
}
