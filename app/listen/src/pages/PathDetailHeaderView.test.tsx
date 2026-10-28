import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { PathDetailHeaderView } from "./PathDetailHeaderView";

describe("Path detail header", () => {
  it("starts with the path identity without a redundant return link or reserved back row", () => {
    const onPlay = vi.fn();
    renderWithListenProviders(
      <PathDetailHeaderView
        name="The Clash → Erik Urano"
        origin="The Clash"
        destination="Erik Urano"
        count={50}
        regenerating={false}
        onPlay={onPlay}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "The Clash → Erik Urano" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Paths" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("page-header").firstElementChild).toHaveAttribute(
      "data-slot",
      "page-header-layout",
    );
    expect(screen.getByText("50 tracks")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledOnce();
  });
});
