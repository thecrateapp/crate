import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { RadioStationCard } from "./RadioStationCard";
import type { RadioStationLike } from "./radio-station-view";

const station: RadioStationLike = {
  type: "artist",
  title: "Converge Radio",
  seed_type: "artist",
  seed_value: "7",
  seed_label: "Converge",
  play_count: 24,
  artist_name: "Converge",
  artist_id: 7,
  artist_slug: "converge",
};

describe("RadioStationCard", () => {
  it("renders an article with an inner start button", () => {
    const onPlay = vi.fn();
    renderWithListenProviders(
      <RadioStationCard station={station} onPlay={onPlay} />,
    );

    const start = screen.getByRole("button", {
      name: "Start Converge Artist Radio",
    });
    expect(start.closest("article")).toHaveClass("home-radio-card");
    fireEvent.click(start);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("24 plays")).toBeNull();
  });

  it("shows play counts when requested", () => {
    renderWithListenProviders(
      <RadioStationCard station={station} onPlay={vi.fn()} showPlayCount />,
    );
    expect(screen.getByText(/24 plays/)).toBeInTheDocument();
  });

  it("opens the radio menu from the more button and starts the station", () => {
    const onPlay = vi.fn();
    renderWithListenProviders(
      <RadioStationCard station={station} onPlay={onPlay} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /Go to artist/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Start radio/ }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("opens the radio menu with a touch long-press without starting", () => {
    vi.useFakeTimers();
    const onPlay = vi.fn();
    try {
      renderWithListenProviders(
        <RadioStationCard station={station} onPlay={onPlay} />,
      );
      const start = screen.getByRole("button", { name: /Start Converge/ });
      fireEvent.pointerDown(start, { pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.pointerUp(start, { pointerType: "touch" });
      fireEvent.click(start);
    } finally {
      vi.useRealTimers();
    }

    expect(
      screen.getByRole("menuitem", { name: /Start radio/ }),
    ).toBeInTheDocument();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("opens the radio menu with a context click", () => {
    renderWithListenProviders(
      <RadioStationCard
        station={{
          type: "genre",
          title: "hardcore Radio",
          seed_type: "genre",
          seed_value: "hardcore",
          seed_label: "hardcore",
          genre_slug: "hardcore",
        }}
        onPlay={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("article"), {
      clientX: 5,
      clientY: 5,
    });
    expect(
      screen.getByRole("menuitem", { name: /Open genre/ }),
    ).toBeInTheDocument();
  });
});
