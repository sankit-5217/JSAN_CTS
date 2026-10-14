import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { correlationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { findProductionAuthConfigProblems } from "./modules/auth/production-auth-config";
import { allowedCorsOrigins, apiDocsEnabled, listenPort } from "./common/http/deploy-config";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProduction = process.env.NODE_ENV === "production";

  // Behind Railway's edge (or any load balancer) the socket address is the
  // proxy's; trust its X-Forwarded-For so req.ip — and with it the rate
  // limits — sees the real client. TRUST_PROXY=0 turns it off.
  app.set("trust proxy", process.env.TRUST_PROXY === "0" ? false : 1);

  // Only the web app may call the API from a browser. Machine callers
  // (collectors, Zabbix, Alertmanager) don't send an Origin and are unaffected.
  const origins = allowedCorsOrigins(process.env);
  app.enableCors({ origin: origins ?? true, credentials: true });

  // Railway sends SIGTERM before replacing an instance: finish in-flight
  // requests and close DB/Redis connections instead of dropping them.
  app.enableShutdownHooks();

  // After create(): ConfigModule has loaded .env into process.env by now.
  if (process.env.NODE_ENV === "production") {
    const logger = new Logger("AuthConfig");
    const { errors, warnings } = findProductionAuthConfigProblems(process.env);
    warnings.forEach((w) => logger.warn(w));
    if (errors.length > 0) {
      errors.forEach((e) => logger.error(e));
      logger.error("Refusing to start with an unsafe production auth configuration.");
      await app.close();
      process.exit(1);
    }
  }

  app.use(correlationIdMiddleware);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (apiDocsEnabled(process.env)) {
    const config = new DocumentBuilder()
    .setTitle("JSAN Data Center OpsDesk API")
    .setDescription("ITSM + CMDB + monitoring integration platform for JSAN data-center operations")
    .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = listenPort(process.env);
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(
    `OpsDesk API listening on :${port}${apiDocsEnabled(process.env) ? " (docs at /api/docs)" : ""}` +
      `${isProduction ? `, CORS origins: ${origins?.join(", ") ?? "any"}` : ""}`,
  );
}

bootstrap();
