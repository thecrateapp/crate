import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MatchCard } from "./MatchCard";
it("preserves MusicBrainz preview differences and explicit apply action in the entity row", async () => {
  const apply = vi.fn();
  render(
    <MatchCard
      match={{
        title: "Jane Doe",
        artist: "Converge",
        track_count: 12,
        match_score: 95,
        tag_preview: [
          {
            current_title: "Before",
            new_title: "After",
            new_track: "1",
            duration_diff: 1,
          },
        ],
      }}
      onApply={apply}
    />,
  );
  expect(screen.getByText("95% match")).toHaveAttribute(
    "data-slot",
    "info-badge",
  );
  expect(screen.getByText("Before")).toHaveClass("line-through");
  expect(screen.getByText("After")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledOnce();
});
