import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../common/prisma/prisma.service";
import { PasswordAuthService } from "../modules/auth/password-auth.service";

/**
 * Break-glass / first-deploy tool: emails an invite (or reset) link to one
 * existing, active user and prints it — for bootstrapping the first Super
 * Admin when nobody can sign in yet. Runs on the API host with the API's
 * environment; audited like any other link (actor: none).
 *
 *   node dist/cli/send-sign-in-link.js admin@jsan.example      (production build)
 *   pnpm --filter @cts-dc-opsdesk/api auth:sign-in-link admin@jsan.example   (dev)
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error("usage: send-sign-in-link <email>");
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const user = await app.get(PrismaService).user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user) throw new Error(`No user with email ${email} — add them first`);
    if (!user.isActive) throw new Error(`${email} is deactivated — reactivate them first`);

    const result = await app.get(PasswordAuthService).sendSignInLink(user.id, { actorId: null });
    // eslint-disable-next-line no-console
    console.log(
      `${result.purpose === "INVITE" ? "Invite" : "Reset"} link for ${user.email} ` +
        `(${result.emailQueued ? "also emailed" : "NOT emailed — send it yourself"}; ` +
        `expires ${result.expiresAt.toISOString()}):\n${result.link}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
