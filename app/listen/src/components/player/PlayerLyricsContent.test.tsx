import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { PlayerLyricsContent } from "./PlayerLyricsContent";
it("uses canonical full-width loading and an explicit retry state", () => {
  const retry = vi.fn();
  const { rerender, container } = renderWithListenProviders(
    <PlayerLyricsContent
      lyrics={null}
      loading
      presentation="drawer"
      onSeek={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("status", { name: "Loading lyrics..." }),
  ).toBeInTheDocument();
  expect(
    container.querySelector(".crate-loading-section-full"),
  ).toBeInTheDocument();
  rerender(
    <PlayerLyricsContent
      lyrics={null}
      loading={false}
      error
      onRetry={retry}
      presentation="drawer"
      onSeek={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
});
it("preserves plain case and whitespace, flat background and actual timed seek", () => {
  const seek = vi.fn();
  const { rerender, container } = renderWithListenProviders(
    <PlayerLyricsContent
      lyrics={{ synced: null, plain: "First line\nSecond line" }}
      loading={false}
      presentation="fullscreen"
      onSeek={seek}
    />,
  );
  expect(container.querySelector("pre")).toHaveTextContent("First line");
  expect(
    container.querySelector('[data-slot="player-lyrics-surface"]'),
  ).toBeInTheDocument();
  expect(container.innerHTML).not.toContain("gradient");
  rerender(
    <PlayerLyricsContent
      lyrics={{ synced: [{ time: 12, text: "Seek here" }], plain: null }}
      loading={false}
      presentation="drawer"
      onSeek={seek}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Seek here" }));
  expect(seek).toHaveBeenCalledWith(12);
});
