import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./TopBar";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/components/layout/topbar/TopBarSearch", () => ({
  TopBarSearch: () => <div data-testid="topbar-search" />,
}));

vi.mock("@/components/layout/topbar/TopBarUserMenu", () => ({
  TopBarUserMenu: () => <div data-testid="topbar-user-menu" />,
}));

describe("TopBar", () => {
  it("keeps search and user menu visible by default", () => {
    renderWithListenProviders(<TopBar />);

    expect(screen.getByTestId("topbar-actions")).toHaveClass("flex");
    expect(screen.getByTestId("topbar-search")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-user-menu")).toBeInTheDocument();
  });

  it("removes search, user menu, and their action container on overlay pages", () => {
    renderWithListenProviders(<TopBar hideMobileActions />);

    expect(screen.queryByTestId("topbar-actions")).toBeNull();
    expect(screen.queryByTestId("topbar-search")).toBeNull();
    expect(screen.queryByTestId("topbar-user-menu")).toBeNull();
  });

  it("localizes navigation controls without native duplicate hints", async () => {
    renderWithListenProviders(<TopBar />, { locale: "es" });

    const back = screen.getByRole("button", { name: "Volver" });
    const forward = screen.getByRole("button", { name: "Avanzar" });
    expect(back).not.toHaveAttribute("title");
    expect(forward).not.toHaveAttribute("title");
    await userEvent.tab();
    expect(back).toHaveFocus();
    expect(
      await screen.findByRole("tooltip", { name: "Volver" }),
    ).toBeVisible();
  });

  it("uses semantic text tokens for navigation controls", () => {
    renderWithListenProviders(<TopBar />);

    expect(screen.getByRole("button", { name: "Go back" })).toHaveClass(
      "text-text-secondary",
      "hover:text-accent-action-hi",
    );
  });
});
