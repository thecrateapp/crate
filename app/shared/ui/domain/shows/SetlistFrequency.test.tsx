import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SetlistFrequency } from "./SetlistFrequency";

describe("SetlistFrequency", () => {
  it("keeps the rail, percentage and plays in fixed slots", () => {
    const { container } = render(
      <>
        <SetlistFrequency
          frequency={1}
          label="Hey frequency"
          plays="12 plays"
        />
        <SetlistFrequency
          frequency={0.07}
          label="Tame frequency"
          plays="1 play"
        />
      </>,
    );

    const rows = container.querySelectorAll('[data-slot="setlist-frequency"]');
    for (const row of rows) {
      expect(row).toHaveClass("grid", "grid-cols-[3rem_6ch_auto]");
      expect(row.children).toHaveLength(3);
    }
    expect(screen.getByText("100%")).toHaveClass("text-right");
    expect(screen.getByText("7%")).toHaveClass("text-right");
    expect(
      screen.getByRole("progressbar", { name: "Hey frequency" }),
    ).toBeInTheDocument();
  });

  it("reserves the date slot even when a song has no last play", () => {
    const { container } = render(
      <>
        <SetlistFrequency
          frequency={0.5}
          label="Cactus frequency"
          plays="6 plays"
          showLastPlayed
          lastPlayed="2026-10-12"
        />
        <SetlistFrequency
          frequency={0.5}
          label="Caribou frequency"
          plays="6 plays"
          showLastPlayed
        />
      </>,
    );

    for (const row of container.querySelectorAll(
      '[data-slot="setlist-frequency"]',
    )) {
      expect(row).toHaveClass(
        "grid-cols-[3rem_6ch_12ch]",
        "sm:grid-cols-[3rem_6ch_12ch_13ch]",
      );
      expect(row.children).toHaveLength(4);
    }
    expect(screen.getByText("2026-10-12")).toHaveClass("hidden", "sm:block");
  });

  it("clamps out-of-range and missing frequencies instead of overflowing", () => {
    render(
      <>
        <SetlistFrequency frequency={1.4} label="Over" plays="3 plays" />
        <SetlistFrequency
          frequency={Number.NaN}
          label="Unknown"
          plays="0 plays"
        />
      </>,
    );

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
