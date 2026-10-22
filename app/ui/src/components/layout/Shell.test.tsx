import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Shell } from "./Shell";

vi.mock("@/hooks/use-notifications", () => ({ useNotifications: () => {} }));
vi.mock("@/contexts/OpsSnapshotContext", () => ({
  useOpsSnapshot: () => ({ data: null }),
}));
vi.mock("./SearchBar", () => ({
  SearchBar: () => <input aria-label="Search library" />,
}));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));

const originalUrl = window.location.href;
afterEach(() => window.history.replaceState(null, "", originalUrl));

it("uses visible names for history, mobile navigation and help close", async () => {
  const user = userEvent.setup();
  renderWithAdminProviders(<Shell />);
  expect(
    screen
      .getByRole("button", { name: "Go back" })
      .querySelector('[data-admin-ux="history-back"]'),
  ).toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "Go forward" })
      .querySelector('[data-admin-ux="history-forward"]'),
  ).toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "Open navigation" })
      .querySelector('[data-admin-ux="mobile-navigation"]'),
  ).toBeInTheDocument();
  screen.getByRole("button", { name: "Go back" }).focus();
  fireEvent.keyDown(document, { key: "?" });
  const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
  expect(dialog.querySelectorAll("svg")).toHaveLength(1);
  screen.getByRole("button", { name: "Close" }).focus();
  fireEvent.keyDown(document, { key: "?" });
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus();
});

it("offers the skip link first and transfers keyboard focus to the real main landmark", async () => {
  window.history.replaceState(null, "", "/tasks?tab=running#details");
  const user = userEvent.setup();
  renderWithAdminProviders(<Shell />, { route: "/tasks?tab=running#details" });
  const link = screen.getByRole("link", { name: "Skip to main content" });
  const main = screen.getByRole("main");
  expect(main).toHaveAttribute("tabindex", "-1");
  expect(link).toHaveAttribute("href", `#${main.id}`);
  await user.tab();
  expect(link).toHaveFocus();
  const url = window.location.href;
  await user.keyboard("{Enter}");
  expect(main).toHaveFocus();
  expect(window.location.href).toBe(url);
});

it("updates the content offset when the sidebar preference event changes", () => {
  localStorage.setItem("crate-admin-sidebar-expanded", "true");
  renderWithAdminProviders(<Shell />);
  const main = screen.getByRole("main");
  expect(main).toHaveClass("md:ml-60");
  localStorage.setItem("crate-admin-sidebar-expanded", "false");
  fireEvent(window, new Event("crate-admin-sidebar-changed"));
  expect(main).toHaveClass("md:ml-36");
});

it("uses a solid app surface for both fixed shell headers", () => {
  const { container } = renderWithAdminProviders(<Shell />);
  for (const slot of ["mobile-shell-header", "desktop-shell-header"]) {
    const header = container.querySelector(`[data-admin-ux="${slot}"]`);
    expect(header).toHaveClass("bg-app-surface");
    expect(header).not.toHaveClass("backdrop-blur-xl");
  }
  expect(
    screen.getAllByRole("button", { name: "Admin account menu" }),
  ).toHaveLength(2);
});
