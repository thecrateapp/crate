import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { GenrePill } from "./GenrePill";

describe("GenrePill", () => {
  it("keeps the remove action inside the pill container", () => {
    render(
      <GenrePill
        item={{ name: "Hardcore punk", slug: "hardcore-punk" }}
        onRemove={vi.fn()}
        removeLabel="Remove Hardcore punk"
      />,
    );

    const removeButton = screen.getByRole("button", {
      name: "Remove Hardcore punk",
    });
    expect(removeButton.closest("span")).toHaveClass(
      "rounded-md",
      "border",
      "text-badge",
    );
  });

  it("uses compact badge typography for the percentage", () => {
    render(<GenrePill item={{ name: "Hardcore punk", percent: 42 }} />);

    expect(screen.getByText("42%")).toHaveClass("text-badge");
  });

  it("renders the name in primary text and keeps the percentage accented", () => {
    render(<GenrePill item={{ name: "Shoegaze", share: 0.314 }} />);

    const pill = screen.getByTitle("Shoegaze · 31%");
    expect(pill).toHaveClass("genre-pill", "rounded-md", "border");
    expect(pill.className).not.toContain("--active-text");
    expect(screen.getByText("31%").className).toContain("--active-text");
  });

  it("renders a button when clickable", () => {
    const onClick = vi.fn();
    render(<GenrePill item={{ name: "Shoegaze" }} onClick={onClick} />);

    screen.getByRole("button", { name: "shoegaze" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "shoegaze" })).toHaveClass(
      "genre-pill",
    );
  });
});
