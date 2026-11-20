import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SendingEmailPage } from "./SendingEmailPage";

const auth = vi.hoisted(() => ({ role: "SUPER_ADMIN", token: "session" }));
vi.mock("../api/jwt", () => ({
  getCurrentUserRole: () => auth.role,
  passwordChangeRequired: () => false,
}));
vi.mock("../api/client", () => ({
  getStoredToken: () => auth.token,
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <span data-redirect={to} />,
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useSearchParams: () => [new URLSearchParams()],
}));

describe("personal sender setup access", () => {
  beforeEach(() => {
    auth.role = "SUPER_ADMIN";
    auth.token = "session";
  });
  it.each(["CLIENT_MANAGER_VIEWER", "SITE_ENGINEER", "SERVICE_DESK_NOC", "SUPER_ADMIN"])(
    "lets a %s connect their own registered email",
    (role) => {
      auth.role = role;
      const html = renderToStaticMarkup(<SendingEmailPage />);
      expect(html).toContain("Your sending email");
      expect(html).toContain("Each user connects their own mailbox.");
      expect(html).not.toContain("data-redirect=");
    },
  );
  it("requires sign-in before mailbox setup", () => {
    auth.token = "";
    expect(renderToStaticMarkup(<SendingEmailPage />)).toContain('data-redirect="/login"');
  });
});
