import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./TopBar";

vi.mock("@/components/layout/topbar/TopBarSearch", () => ({
  TopBarSearch: () => <div data-testid="topbar-search" />,
}));

vi.mock("@/components/layout/topbar/TopBarUserMenu", () => ({
  TopBarUserMenu: () => <div data-testid="topbar-user-menu" />,
}));

describe("TopBar", () => {
  it("keeps search and user menu visible by default", () => {
    render(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("topbar-actions")).toHaveClass("flex");
    expect(screen.getByTestId("topbar-search")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-user-menu")).toBeInTheDocument();
  });

  it("removes search, user menu, and their action container on overlay pages", () => {
    render(
      <MemoryRouter>
        <TopBar hideMobileActions />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("topbar-actions")).toBeNull();
    expect(screen.queryByTestId("topbar-search")).toBeNull();
    expect(screen.queryByTestId("topbar-user-menu")).toBeNull();
  });
});
