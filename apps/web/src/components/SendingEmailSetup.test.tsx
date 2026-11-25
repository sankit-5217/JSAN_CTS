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
    ["Alert", "Box", "Button", "CircularProgress", "Stack", "TextField", "Typography"].map(
      (name) => [name, name.toLowerCase()],
    ),
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
    const view = await mount(<SendingEmailSetup onContinue={onContinue} next="/client/home" />);
    expect(onContinue).toHaveBeenCalled();
    expect(view.toJSON()).toBeNull();
  });

  it("only shows a loading indicator while checking an existing connection", async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const view = await mount(<SendingEmailSetup onContinue={vi.fn()} />);
    expect(text(view)).toContain("Checking email connection");
    expect(text(view)).not.toContain("Connect the mailbox");
  });

  it("removes app-password controls even when the API offers providers", async () => {
    api.get.mockResolvedValue(
      status({
        smtpProviders: [{ provider: "yahoo" }, { provider: "icloud" }, { provider: "zoho" }],
      }),
    );
    const view = await mount(<SendingEmailSetup next="/client/home" />);
    expect(text(view)).not.toContain("app password");
    expect(text(view)).not.toContain("App password");
    expect(text(view)).not.toContain("Yahoo");
    expect(text(view)).not.toContain("iCloud");
    expect(text(view)).not.toContain("Zoho");
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

  it.each([false, true])(
    "hides the Google connection option when configured=%s",
    async (configured) => {
      api.get.mockResolvedValue(
        status({
          providers: [
            { provider: "google", configured },
            { provider: "microsoft", configured: true },
          ],
        }),
      );
      const view = await mount(<SendingEmailSetup />);
      const buttons = view.root.findAllByType("button");
      expect(buttons.some((b) => JSON.stringify(b.props.children).includes("Gmail"))).toBe(false);
      const microsoft = buttons.find((b) => JSON.stringify(b.props.children).includes("Outlook"));
      expect(microsoft).toBeDefined();
      expect(microsoft?.props.disabled).toBe(false);
    },
  );

  it("labels a connected Google mailbox as Gmail", async () => {
    api.get.mockResolvedValue(
      status({
        senderEmail: "person@gmail.com",
        account: { email: "person@gmail.com", provider: "google", updatedAt: "2026-11-20" },
      }),
    );
    const view = await mount(<SendingEmailSetup />);
    const connected = view.root.findByProps({ severity: "success" });
    expect(JSON.stringify(connected.props.children)).toContain("Gmail / Google Workspace");
    expect(JSON.stringify(connected.props.children)).not.toContain("Microsoft");
  });
});
