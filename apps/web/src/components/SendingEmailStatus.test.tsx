import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SendingEmailResult, SendingEmailStatus } from "./SendingEmailStatus";
import { AccountMenu } from "./AccountMenu";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  params: new URLSearchParams(),
  setParams: vi.fn(),
}));
vi.mock("../api/client", () => ({ apiGet: mocks.get }));
vi.mock("react-router-dom", () => ({
  Link: "a",
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.params, mocks.setParams],
}));
vi.mock("@mui/material", () =>
  Object.fromEntries(
    [
      "Alert",
      "Avatar",
      "Box",
      "Button",
      "Divider",
      "Menu",
      "MenuItem",
      "Stack",
      "Tooltip",
      "Typography",
    ].map((name) => [name, name.toLowerCase()]),
  ),
);
vi.mock("@mui/icons-material/ExpandMoreOutlined", () => ({ default: "icon" }));
vi.mock("@mui/icons-material/KeyOutlined", () => ({ default: "icon" }));
vi.mock("@mui/icons-material/LogoutOutlined", () => ({ default: "icon" }));

const mount = async (element: React.ReactElement) => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(element);
  });
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = new URLSearchParams();
});

describe("email connection after sign-in", () => {
  it("keeps only password and logout actions in the shared account menu", async () => {
    const logout = vi.fn();
    const view = await mount(
      <AccountMenu
        email="client@example.com"
        roleLabel="Client"
        roleColor="#000000"
        onLogout={logout}
      />,
    );
    const items = view.root.findAllByType("menuitem");
    expect(items).toHaveLength(2);
    const text = JSON.stringify(view.toJSON());
    expect(text).toContain("Change password");
    expect(text).toContain("Log out");
    expect(text).not.toContain("Sending email");
    items[1].props.onClick();
    expect(logout).toHaveBeenCalledOnce();
  });

  it("hides mailbox status for a matching connected address", async () => {
    mocks.get.mockResolvedValue({
      senderEmail: "client@example.com",
      account: { email: "CLIENT@example.com" },
    });
    const view = await mount(<SendingEmailStatus />);
    expect(view.toJSON()).toBeNull();
  });

  it.each([null, { email: "other@example.com" }])(
    "keeps a connection action for a missing or mismatched mailbox: %s",
    async (account) => {
      mocks.get.mockResolvedValue({ senderEmail: "client@example.com", account });
      const view = await mount(<SendingEmailStatus />);
      const alert = view.root.findByProps({ severity: "info" });
      expect(alert.props.children).toContain("not connected yet");
      expect(alert.props.action.props.to).toBe("/account/email");
    },
  );

  it("removes a successful callback marker without showing setup or a banner", async () => {
    mocks.params = new URLSearchParams("result=connected&tab=tickets");
    const view = await mount(<SendingEmailResult />);
    expect(view.toJSON()).toBeNull();
    expect(mocks.setParams).toHaveBeenCalledWith(new URLSearchParams("tab=tickets"), {
      replace: true,
    });
  });

  it("retains retry when provider consent fails", async () => {
    mocks.params = new URLSearchParams("result=failed");
    const view = await mount(<SendingEmailResult />);
    const alert = view.root.findByProps({ severity: "error" });
    expect(alert.props.children).toContain("could not be connected");
    expect(alert.props.action.props.to).toBe("/account/email");
    expect(mocks.setParams).not.toHaveBeenCalled();
  });
});
