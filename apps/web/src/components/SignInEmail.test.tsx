import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInCard } from "./SignInCard";
import { SendingEmailSetup } from "./SendingEmailSetup";
import { ChangePasswordPage } from "../pages/ChangePasswordPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";
import { SendingEmailPage } from "../pages/SendingEmailPage";

const mocks = vi.hoisted(() => ({
  token: "",
  required: false,
  destination: "/client/home",
  navigate: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("../api/client", () => ({
  getStoredToken: () => mocks.token,
  storeToken: (token: string) => {
    mocks.token = token;
  },
  signOut: vi.fn(),
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiDelete: mocks.remove,
  ApiError: class extends Error {},
}));
vi.mock("../api/jwt", () => ({
  landingPathFor: () => mocks.destination,
  passwordChangeRequired: () => mocks.required,
  decodeJwtPayload: () => ({ email: "client@example.com" }),
  getCurrentUserRole: () =>
    mocks.destination === "/client/home" ? "CLIENT_MANAGER_VIEWER" : "SUPER_ADMIN",
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams()],
  Navigate: "redirect",
  Link: "a",
}));
vi.mock("@mui/material", () =>
  Object.fromEntries(
    [
      "Alert",
      "Box",
      "Button",
      "Card",
      "CardContent",
      "CircularProgress",
      "Dialog",
      "DialogActions",
      "DialogContent",
      "DialogTitle",
      "IconButton",
      "InputAdornment",
      "Link",
      "Stack",
      "TextField",
      "Typography",
    ].map((name) => [name, name.toLowerCase()]),
  ),
);
vi.mock("../theme/theme", () => ({ theme: { palette: { secondary: { dark: "#000" } } } }));
vi.mock("@mui/icons-material/LoginOutlined", () => ({ default: "icon" }));
vi.mock("@mui/icons-material/VisibilityOffOutlined", () => ({ default: "icon" }));
vi.mock("@mui/icons-material/VisibilityOutlined", () => ({ default: "icon" }));

const status = (email: string | null = null) => ({
  senderEmail: "client@example.com",
  account: email ? { email, provider: "google", updatedAt: "2026-11-20" } : null,
  providers: [
    { provider: "google", configured: true },
    { provider: "microsoft", configured: true },
  ],
});
let view: ReactTestRenderer;
const mount = async (element: React.ReactElement) => {
  await act(async () => {
    view = create(element);
  });
};
const change = async (label: string, value: string) => {
  await act(async () => {
    view.root.findByProps({ label }).props.onChange({ target: { value } });
  });
};
const submit = async () => {
  await act(async () => {
    await view.root.findByProps({ component: "form" }).props.onSubmit({ preventDefault() {} });
  });
};
const button = (text: string) =>
  view.root
    .findAllByType("button")
    .find((node) =>
      node.children.some((child) => typeof child === "string" && child.includes(text)),
    )!;
const signIn = async () => {
  await mount(createElement(SignInCard));
  await change("Work email", "client@example.com");
  await change("Password", "my password");
  await submit();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "";
  mocks.required = false;
  mocks.destination = "/client/home";
  mocks.get.mockResolvedValue(status());
  mocks.post.mockResolvedValue({ accessToken: "session" });
  vi.stubGlobal("window", {
    location: { assign: mocks.assign, hash: "#token=invite", pathname: "/auth/set-password" },
    history: { replaceState: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("mailbox connection during sign-in", () => {
  it("offers the registered mailbox inline immediately after successful authentication", async () => {
    await signIn();
    expect(mocks.token).toBe("session");
    expect(mocks.get).toHaveBeenCalledWith("/sending-mail");
    expect(view.root.findAllByType(SignInCard)).toHaveLength(1);
    expect(view.root.findAllByType(SendingEmailSetup)).toHaveLength(1);
    expect(JSON.stringify(view.toJSON())).toContain("client@example.com");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(["/client/home", "/"])(
    "continues a matching connected user to %s",
    async (destination) => {
      mocks.destination = destination;
      mocks.get.mockResolvedValue(status("CLIENT@example.com"));
      await signIn();
      expect(mocks.navigate).toHaveBeenCalledWith(destination, { replace: true });
      expect(JSON.stringify(view.toJSON())).not.toContain("Your sending email");
    },
  );

  it("requires reconnection when the saved mailbox differs from the registered address", async () => {
    mocks.get.mockResolvedValue(status("old@example.com"));
    await signIn();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain("Connect your registered mailbox");
  });

  it("starts Microsoft consent from the inline step", async () => {
    await signIn();
    expect(button("Microsoft").props.disabled).toBe(false);
    expect(button("Gmail")).toBeUndefined();
    mocks.post.mockResolvedValue({ url: "https://login.microsoftonline.com/consent" });
    await act(async () => {
      button("Microsoft").props.onClick();
    });
    expect(mocks.post).toHaveBeenLastCalledWith("/sending-mail/connect/microsoft");
    expect(mocks.assign).toHaveBeenCalledWith("https://login.microsoftonline.com/consent");
  });

  it("allows continuing without connecting", async () => {
    await signIn();
    await act(async () => {
      button("Continue without").props.onClick();
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/client/home", { replace: true });
  });

  it("keeps authentication successful when mailbox status fails and allows retry", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    await signIn();
    expect(mocks.token).toBe("session");
    expect(JSON.stringify(view.toJSON())).toContain("Could not update your email connection");
    await act(async () => {
      button("Retry").props.onClick();
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(view.toJSON())).toContain("client@example.com");
  });

  it("shows provider connection failure and permits another attempt", async () => {
    await signIn();
    mocks.post.mockRejectedValueOnce(new Error("provider offline"));
    await act(async () => {
      button("Microsoft").props.onClick();
    });
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(button("Microsoft").props.disabled).toBe(false);
    expect(JSON.stringify(view.toJSON())).toContain("Could not update your email connection");
  });

  it("does not check mailbox status when sign-in fails", async () => {
    mocks.post.mockRejectedValueOnce(new Error("bad password"));
    await signIn();
    expect(mocks.token).toBe("");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("requires an admin-set password to be changed before checking the mailbox", async () => {
    mocks.post.mockResolvedValue({ accessToken: "session", mustChangePassword: true });
    await signIn();
    expect(mocks.navigate).toHaveBeenCalledWith("/auth/change-password", { replace: true });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("offers the inline mailbox step after the required password change", async () => {
    mocks.token = "initial-session";
    mocks.required = true;
    await mount(createElement(ChangePasswordPage));
    await change("Starting password", "temporary password");
    await change("New password", "new password with enough length");
    await change("Confirm new password", "new password with enough length");
    await submit();
    expect(mocks.post).toHaveBeenCalledWith("/auth/password/change", expect.any(Object));
    expect(view.root.findAllByType(SendingEmailSetup)).toHaveLength(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("offers mailbox setup after accepting an invitation", async () => {
    mocks.post.mockImplementation(async (path) =>
      path === "/auth/password/inspect"
        ? { email: "client@example.com", displayName: "Client", purpose: "INVITE" }
        : { accessToken: "session" },
    );
    await mount(createElement(SetPasswordPage));
    await change("New password", "new password with enough length");
    await change("Confirm new password", "new password with enough length");
    await submit();
    expect(mocks.post).toHaveBeenCalledWith("/auth/password/set", expect.any(Object));
    expect(view.root.findAllByType(SendingEmailSetup)).toHaveLength(1);
  });

  it.each(["/client/home", "/"])(
    "leaves the setup URL for connected users at %s",
    async (destination) => {
      mocks.token = "session";
      mocks.destination = destination;
      mocks.get.mockResolvedValue(status("client@example.com"));
      await mount(createElement(SendingEmailPage));
      expect(mocks.navigate).toHaveBeenCalledWith(destination, { replace: true });
      expect(JSON.stringify(view.toJSON())).not.toContain("Your sending email");
    },
  );

  it("skips mailbox setup after changing a connected user's password", async () => {
    mocks.token = "session";
    mocks.get.mockResolvedValue(status("client@example.com"));
    await mount(createElement(ChangePasswordPage));
    await change("Current password", "current password");
    await change("New password", "new password with enough length");
    await change("Confirm new password", "new password with enough length");
    await submit();
    expect(mocks.navigate).toHaveBeenCalledWith("/client/home", { replace: true });
    expect(JSON.stringify(view.toJSON())).not.toContain("Your sending email");
  });
});
