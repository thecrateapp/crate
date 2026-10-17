import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
vi.mock("@/contexts/OpsSnapshotContext", () => ({
  useOpsSnapshot: () => ({
    data: { status: { issue_count: 3, running_tasks: 12 } },
  }),
}));
import { Sidebar, SIDEBAR_KEY, SIDEBAR_EVENT } from "./Sidebar";
const only = (...granted: string[]) => ({
  hasAnyCapability: (required: readonly string[]) =>
    required.some((item) => granted.includes(item)),
});
function Location() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}
describe("Sidebar", () => {
  beforeEach(() => localStorage.removeItem(SIDEBAR_KEY));
  it("links settings administrators to translation review", () => {
    renderWithAdminProviders(<Sidebar />, { auth: only("admin.access") });
    expect(screen.getByRole("link", { name: "Translations" })).toHaveAttribute(
      "href",
      "/i18n",
    );
    expect(
      screen.queryByRole("link", { name: "Browse" }),
    ).not.toBeInTheDocument();
  });
  it("keeps complete text destinations, callbacks and user actions in the compact rail", async () => {
    const user = userEvent.setup(),
      onNavigate = vi.fn(),
      logout = vi.fn(),
      sync = vi.fn();
    window.addEventListener(SIDEBAR_EVENT, sync);
    const { container } = renderWithAdminProviders(
      <>
        <Sidebar onNavigate={onNavigate} />
        <Location />
      </>,
      { auth: { ...only("admin.access"), logout } },
    );
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("false");
    expect(sync).toHaveBeenCalledOnce();
    const link = screen.getByRole("link", { name: "Translations" });
    expect(link).toHaveTextContent("Translations");
    expect(container.querySelectorAll("nav svg")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Logout" })).toHaveTextContent(
      "Logout",
    );
    expect(
      screen.getByRole("link", { name: "Admin profile" }),
    ).toHaveTextContent("Admin");
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/i18n");
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(logout).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("true");
    window.removeEventListener(SIDEBAR_EVENT, sync);
  });
  it("restores a compact preference without hiding full destination names or counts", () => {
    localStorage.setItem(SIDEBAR_KEY, "false");
    renderWithAdminProviders(<Sidebar />, {
      auth: only("ops.tasks.manage", "library.repair.run"),
    });
    const nav = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(nav).getByRole("link", { name: /Tasks/ })).toHaveTextContent(
      "Tasks12",
    );
    expect(
      within(nav).getByRole("link", { name: /Library Health/ }),
    ).toHaveTextContent("Library Health3");
    expect(
      screen
        .getByRole("button", { name: "Expand sidebar" })
        .querySelector('[data-admin-ux="sidebar-expand"]'),
    ).toBeInTheDocument();
    expect(within(nav).queryByText("Insights")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Music")).not.toBeInTheDocument();
  });
  it("shows complete drawer navigation with a text close without changing the stored rail preference", async () => {
    localStorage.setItem(SIDEBAR_KEY, "false");
    const close = vi.fn(),
      user = userEvent.setup();
    renderWithAdminProviders(
      <Sidebar presentation="drawer" onNavigate={close} />,
    );
    expect(
      screen.getByRole("link", { name: "System Playlists" }),
    ).toHaveTextContent("System Playlists");
    expect(
      screen.queryByRole("button", { name: "Expand sidebar" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(close).toHaveBeenCalledOnce();
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("false");
  });
});
