import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { correlationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { findProductionAuthConfigProblems } from "./modules/auth/production-auth-config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

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

  const config = new DocumentBuilder()
    .setTitle("JSAN Data Center OpsDesk API")
    .setDescription("ITSM + CMDB + monitoring integration platform for JSAN data-center operations")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`OpsDesk API listening on :${port} (docs at /api/docs)`);
}

bootstrap();
