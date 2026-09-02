import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";

/** Injects the per-request correlation ID set by CorrelationIdMiddleware. */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.correlationId;
  },
);
