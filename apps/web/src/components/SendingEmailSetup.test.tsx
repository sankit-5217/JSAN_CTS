import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { SendingEmailSetup } from "./SendingEmailSetup";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../api/client", () => ({
  getStoredToken: () => "session",
  apiGet: api.get,
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("react-router-dom", () => ({
  Navigate: () => null,
  useSearchParams: () => [new URLSearchParams()],
}));
// Plain tags instead of the real components: react-test-renderer has no DOM
// refs, and the real MUI would warn about them on every render.
vi.mock("@mui/material", () =>
  Object.fromEntries(
    [
      "Alert",
      "Box",
      "Button",
      "CircularProgress",
      "Stack",
      "TextField",
      "Typography",
    ].map((name) => [name, name.toLowerCase()]),
  ),
);

const status = (overrides: Record<string, unknown> = {}) => ({
  senderEmail: "client@example.com",
  account: null,
  providers: [{ provider: "google", configured: true }],
  smtpProviders: [{ provider: "yahoo" }],
  ...overrides,
});

const mount = async (element: React.ReactElement) => {
  let view: ReactTestRenderer | undefined;
  await act(async () => {
    view = create(element);
  });
  return view!;
};
const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON());

describe("the shared mailbox step", () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it("moves a user with a matching mailbox straight on, with no extra step", async () => {
    api.get.mockResolvedValue(
      status({
        account: {
          email: "client@example.com",
          provider: "google",
          updatedAt: "2026-11-20T10:00:00Z",
        },
      }),
    );
    const onContinue = vi.fn();
    await mount(<SendingEmailSetup onContinue={onContinue} next="/client/home" />);
    expect(onContinue).toHaveBeenCalled();
  });

  it("offers app-password providers to a user who has not connected one yet", async () => {
    api.get.mockResolvedValue(status());
    const view = await mount(<SendingEmailSetup next="/client/home" />);
    expect(text(view)).toContain("Connect with app password");
    expect(text(view)).toContain("Yahoo");
  });

  it("tells every role which address their emails will come from", async () => {
    api.get.mockResolvedValue(status());
    const view = await mount(<SendingEmailSetup next="/" />);
    expect(text(view)).toContain("client@example.com");
  });

  it("copes with an API answer that has no app-password providers", async () => {
    api.get.mockResolvedValue({ ...status(), smtpProviders: undefined });
    const view = await mount(<SendingEmailSetup next="/" />);
    expect(text(view)).toContain("client@example.com");
    expect(text(view)).not.toContain("Connect with app password");
  });
});
