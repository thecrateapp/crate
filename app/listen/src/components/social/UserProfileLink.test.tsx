import { type ReactNode } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { UserProfileLink } from "@/components/social/UserProfileLink";

vi.mock("@/components/social/ProfileHoverCard", () => ({
  ProfileHoverCard: ({
    username,
    children,
    className,
  }: {
    username?: string | null;
    children: ReactNode;
    className?: string;
  }) => (
    <span className={className} data-profile-hover-card={username || ""}>
      {children}
    </span>
  ),
}));

describe("UserProfileLink", () => {
  it("links username mentions to the public profile and wraps hover card", () => {
    renderWithListenProviders(
      <UserProfileLink username="@diego.rin" hoverClassName="block">
        @diego.rin
      </UserProfileLink>,
    );

    const link = screen.getByRole("link", { name: "@diego.rin" });

    expect(link).toHaveAttribute("href", "/users/diego.rin");
    expect(link.parentElement).toHaveAttribute(
      "data-profile-hover-card",
      "diego.rin",
    );
    expect(link.parentElement).toHaveClass("block");
  });

  it("falls back to people without hover behavior when username is missing", () => {
    renderWithListenProviders(<UserProfileLink>Profile</UserProfileLink>);

    const link = screen.getByRole("link", { name: "Profile" });

    expect(link).toHaveAttribute("href", "/people");
    expect(link.parentElement).not.toHaveAttribute("data-profile-hover-card");
  });
});
