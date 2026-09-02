// Augments Express's Request type so `req.correlationId` is known
// project-wide, set by CorrelationIdMiddleware (see main.ts).
declare namespace Express {
  interface Request {
    correlationId?: string;
  }
}
