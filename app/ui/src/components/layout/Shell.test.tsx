import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
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

it("offers the skip link first and transfers keyboard focus to the real main landmark", async () => {
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
