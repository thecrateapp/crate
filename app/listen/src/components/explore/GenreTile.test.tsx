import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { GenreTile } from "./GenreTile";

function renderTile(variant: "room" | "related", onOpen = vi.fn()) {
  renderWithListenProviders(
    <GenreTile
      variant={variant}
      slug="mathcore"
      name="Mathcore"
      kicker={variant === "room" ? "Genre room" : "Parent"}
      detail="Converge, Botch"
      imageCandidates={[]}
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

describe("GenreTile", () => {
  it.each(["room", "related"] as const)(
    "renders %s tiles as an article with an inner open button",
    (variant) => {
      const onOpen = renderTile(variant);
      const article = screen.getByRole("article");
      expect(article).toHaveAttribute("data-variant", variant);
      fireEvent.click(screen.getByRole("button", { name: /Mathcore/ }));
      expect(onOpen).toHaveBeenCalledTimes(1);
    },
  );

  it("opens the genre menu from the more button", () => {
    const onOpen = renderTile("related");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /Play genre radio|radio/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open genre/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the genre menu with a touch long-press without opening", () => {
    vi.useFakeTimers();
    let onOpen = vi.fn();
    try {
      onOpen = renderTile("room");
      const button = screen.getByRole("button", { name: /Mathcore/ });
      fireEvent.pointerDown(button, { pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.pointerUp(button, { pointerType: "touch" });
      fireEvent.click(button);
    } finally {
      vi.useRealTimers();
    }
    expect(
      screen.getByRole("menuitem", { name: /Open genre/ }),
    ).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
