import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: ({
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    src?: string | null;
  }) => <img data-testid="crate-image" src={src ?? undefined} {...props} />,
}));

import { UserAvatar } from "./UserAvatar";

describe("UserAvatar", () => {
  it("renders the avatar through CrateImage", () => {
    render(<UserAvatar name="Ada Lovelace" avatar="/avatars/ada.jpg" />);
    expect(screen.getByTestId("crate-image")).toHaveAttribute(
      "src",
      expect.stringContaining("/avatars/ada.jpg"),
    );
  });

  it("walks the fallback chain before showing initials", () => {
    render(
      <UserAvatar
        name="Ada Lovelace"
        avatar="https://cdn.example.com/ada.jpg"
        userId={7}
      />,
    );
    const primary = screen.getByTestId("crate-image");
    expect(primary).toHaveAttribute(
      "src",
      expect.stringContaining("/api/auth/users/7/avatar"),
    );

    fireEvent.error(primary);
    const fallback = screen.getByTestId("crate-image");
    expect(fallback).toHaveAttribute("src", "https://cdn.example.com/ada.jpg");

    fireEvent.error(fallback);
    expect(screen.queryByTestId("crate-image")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ada Lovelace" })).toHaveTextContent(
      "AL",
    );
  });

  it("shows initials without an avatar", () => {
    render(<UserAvatar name="Ada Lovelace" />);
    expect(screen.queryByTestId("crate-image")).not.toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
