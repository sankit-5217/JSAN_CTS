import { ConfigService } from "@nestjs/config";

export interface AuthConfig {
  /** The web app's origin — where invite and password-reset links land. */
  webAppUrl: string;
}

/**
 * Sign-in is email + password only (Google / Microsoft / GitHub sign-in was
 * removed on 2026-10-15): the only auth setting left is where links point.
 */
export function readAuthConfig(config: ConfigService): AuthConfig {
  const get = (key: string, fallback = "") => (config.get<string>(key) ?? fallback).trim();
  return {
    webAppUrl: get("WEB_APP_URL", "http://localhost:5173").replace(/\/+$/, ""),
  };
}
