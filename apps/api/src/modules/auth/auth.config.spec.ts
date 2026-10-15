import { ConfigService } from "@nestjs/config";
import { readAuthConfig } from "./auth.config";

const cfg = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe("readAuthConfig", () => {
  it("uses WEB_APP_URL without a trailing slash", () => {
    expect(readAuthConfig(cfg({ WEB_APP_URL: "https://opsdesk.jsan.example/" }))).toEqual({
      webAppUrl: "https://opsdesk.jsan.example",
    });
  });

  it("defaults to the local web app", () => {
    expect(readAuthConfig(cfg({})).webAppUrl).toBe("http://localhost:5173");
  });
});
