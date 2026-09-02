import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

const HEADER = "x-correlation-id";

/**
 * Every mutation's audit trail needs a correlation ID (spec §13.1,
 * §14.1). Reuses the caller's `x-correlation-id` if they sent one
 * (useful for tracing a request across the site collector -> API ->
 * worker), otherwise generates one. Echoed back on the response so a
 * client can log it even if they didn't send one themselves.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(HEADER);
  const correlationId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
  req.correlationId = correlationId;
  res.setHeader(HEADER, correlationId);
  next();
}
