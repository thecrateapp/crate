import { expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { ListeningHistorySection } from "./HomeListeningHistory";
it("uses MonoLabel for counts and duration while preserving artist names and callbacks", () => {
  const item = {
    id: "all",
    kind: "all_time" as const,
    title: "My Most Listened",
    period_label: "All time",
    period_start: "2026-01-01",
    subtitle: "Chelsea Wolfe, High Vis",
    top_artists: [],
    play_count: 84,
    minutes_listened: 90,
    artwork_tracks: [],
  };
  const onOpenHistory = vi.fn();
  renderWithListenProviders(
    <ListeningHistorySection items={[item]} onOpenHistory={onOpenHistory} />,
  );
  expect(screen.getByText(/84 plays/)).toHaveClass(
    "font-mono",
    "uppercase",
    "text-label",
  );
  expect(screen.getByText("Chelsea Wolfe, High Vis")).not.toHaveClass(
    "uppercase",
  );
  fireEvent.click(screen.getByText("My Most Listened").closest("button")!);
  expect(onOpenHistory).toHaveBeenCalledWith(item);
});
