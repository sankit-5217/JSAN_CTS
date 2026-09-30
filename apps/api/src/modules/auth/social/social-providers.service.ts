import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthConfig, callbackUrl, readAuthConfig, SocialProviderId } from "../auth.config";
import { GithubSocialClient } from "./github-social.client";
import { OidcSocialClient } from "./oidc-social.client";
import { SocialProviderClient } from "./social-provider";

/** The enabled social sign-in providers, built once from env. */
@Injectable()
export class SocialProvidersService {
  readonly config: AuthConfig;
  private readonly clients = new Map<SocialProviderId, SocialProviderClient>();

  constructor(configService: ConfigService) {
    this.config = readAuthConfig(configService);
    const logger = new Logger(SocialProvidersService.name);
    for (const p of this.config.providers) {
      const redirect = callbackUrl(this.config, p.id);
      this.clients.set(
        p.id,
        p.kind === "github"
          ? new GithubSocialClient(p, redirect)
          : new OidcSocialClient(p, redirect),
      );
    }
    for (const r of this.config.rejected) {
      logger.error(`${r.id} sign-in disabled: ${r.reason}`);
    }
  }

  get(id: string): SocialProviderClient | undefined {
    return this.clients.get(id as SocialProviderId);
  }

  list(): { id: SocialProviderId; label: string }[] {
    return [...this.clients.values()].map((c) => ({ id: c.id, label: c.label }));
  }
}
