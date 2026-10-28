import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { HeaderUserMenu } from "./HeaderUserMenu";

function Route() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

describe("HeaderUserMenu", () => {
  it("keeps profile, logout and role preview together in the avatar menu", async () => {
    const user = userEvent.setup();
    const setPreviewRole = vi.fn();
    const logout = vi.fn();
    renderWithAdminProviders(
      <>
        <HeaderUserMenu />
        <Route />
      </>,
      {
        auth: {
          setPreviewRole,
          logout,
          rolePresets: [
            {
              slug: "curator",
              name: "Curator",
              capabilities: ["curation.playlists.write"],
            },
          ],
        },
      },
    );

    await user.click(
      screen.getByRole("button", { name: "Admin account menu" }),
    );
    const menu = screen.getByRole("menu");
    for (const item of [
      within(menu).getByRole("menuitemradio", { name: "Actual permissions" }),
      within(menu).getByRole("menuitemradio", { name: "Curator" }),
      within(menu).getByRole("menuitem", { name: "Profile" }),
      within(menu).getByRole("menuitem", { name: "Log out" }),
    ]) {
      expect(item.querySelector(".crate-mono-label")).not.toBeNull();
    }
    expect(screen.getByText("admin@cratemusic.app")).toBeVisible();
    expect(
      screen.getByRole("menuitemradio", { name: "Curator" }),
    ).toBeVisible();
    await user.click(screen.getByRole("menuitemradio", { name: "Curator" }));
    expect(setPreviewRole).toHaveBeenCalledWith("curator");

    await user.click(
      screen.getByRole("button", { name: "Admin account menu" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/users");

    await user.click(
      screen.getByRole("button", { name: "Admin account menu" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("shows an initial when no user avatar is available", () => {
    renderWithAdminProviders(<HeaderUserMenu />, {
      auth: {
        user: {
          id: 1,
          email: "diego@example.invalid",
          name: "Diego",
          role: "admin",
        },
      },
    });
    expect(
      screen.getByRole("button", { name: "Diego account menu" }),
    ).toHaveTextContent("D");
  });
});
