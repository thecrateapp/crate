import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { PathDetail } from "./paths-model";
import { PathWarnings } from "./PathWarnings";

const completePath: PathDetail = {
  id: 77,
  name: "A to B",
  origin: { type: "artist", value: "artist-a", label: "Artist A" },
  destination: { type: "artist", value: "artist-b", label: "Artist B" },
  waypoints: [],
  step_count: 2,
  generated_step_count: 2,
  created_at: "2030-01-01T00:00:00Z",
  is_partial: false,
  warnings: [],
  tracks: [
    {
      step: 1,
      progress: 0,
      track_id: 1,
      title: "First",
      artist: "Artist A",
      distance: 0.1,
      playable: true,
    },
    {
      step: 2,
      progress: 1,
      track_id: 2,
      title: "Last",
      artist: "Artist B",
      distance: 0.2,
      playable: true,
    },
  ],
};

it("keeps quality warnings visible on a complete path without calling it incomplete or announcing live status", () => {
  const { container } = renderWithListenProviders(
    <PathWarnings
      path={{
        ...completePath,
        warnings: [{ code: "repeated_artist", artist: "Artist A", step: 2 }],
      }}
    />,
    { locale: "en" },
  );

  expect(container.textContent?.trim()).not.toBe("");
  expect(screen.queryByText("Partial path")).not.toBeInTheDocument();
  expect(
    screen.queryByText("This journey could not be completed as requested."),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not render a warning for a complete available path without quality warnings", () => {
  const { container } = renderWithListenProviders(
    <PathWarnings path={completePath} />,
    { locale: "en" },
  );

  expect(container).toBeEmptyDOMElement();
});
