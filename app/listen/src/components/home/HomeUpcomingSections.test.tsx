import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { HomeUpcomingSection } from "@/components/home/HomeUpcomingSections";
import type { HomeUpcomingItem } from "@/components/home/home-model";
import { I18nProvider } from "@/i18n";
import { HomeShowPrepSection } from "./HomeShowPrep";

const PREVIEW_ITEMS: HomeUpcomingItem[] = [
  {
    id: 1,
    type: "show",
    date: "2030-04-12",
    artist: "High Vis",
    artist_id: 12,
    artist_slug: "high-vis",
    title: "Sala Radar",
    subtitle: "Madrid, Spain",
    venue: "Sala Radar",
    is_upcoming: true,
  },
];

const MULTIPLE_PREVIEW_ITEMS: HomeUpcomingItem[] = [
  {
    type: "release",
    date: "2030-04-12",
    artist: "Artist One",
    title: "First release",
    subtitle: "Album",
    is_upcoming: true,
  },
  {
    type: "show",
    date: "2030-04-20",
    artist: "Artist Two",
    title: "Sala Radar",
    subtitle: "Madrid, Spain",
    is_upcoming: true,
  },
  {
    type: "release",
    date: "2030-05-01",
    artist: "Artist Three",
    title: "Third release",
    subtitle: "Album",
    is_upcoming: true,
  },
];

describe("HomeUpcomingSection", () => {
  it("uses a canonical show-prep card and retains both actions", () => {
    const insight = {
      type: "show_prep" as const,
      show_id: 1,
      artist: "Caspian",
      date: "2030-11-12",
      title: "Caspian at Sala Apolo",
      subtitle: "Barcelona",
      message: "Get ready for the show",
      has_setlist: true,
    };
    const play = vi.fn();
    const save = vi.fn();
    const { container } = renderWithRouter(
      <HomeShowPrepSection
        insights={[insight]}
        onOpenUpcoming={vi.fn()}
        onPlaySetlist={play}
        onSaveReminder={save}
      />,
    );
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play setlist/i }));
    fireEvent.click(screen.getByRole("button", { name: /save for later/i }));
    expect(play).toHaveBeenCalledWith(insight);
    expect(save).toHaveBeenCalledWith(insight);
  });
  it("uses canonical surfaces and labels instead of bespoke glass metadata cards", () => {
    const { container } = renderWithRouter(
      <HomeUpcomingSection
        previewItems={MULTIPLE_PREVIEW_ITEMS}
        onOpenUpcoming={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(2);
    expect(screen.getByText("Next release")).toHaveClass(
      "crate-mono-label",
      "uppercase",
    );
    expect(screen.getByText("Next up")).toHaveClass(
      "crate-mono-label",
      "uppercase",
    );
    expect(
      container.querySelectorAll('[data-slot="hairline-row"]'),
    ).toHaveLength(2);
    expect(container.querySelector(".home-upcoming-meta-card")).toBeNull();
  });

  it("does not create an empty next-up panel for a single event", () => {
    renderWithRouter(
      <HomeUpcomingSection
        previewItems={PREVIEW_ITEMS}
        onOpenUpcoming={vi.fn()}
      />,
    );
    expect(screen.queryByText("Next up")).not.toBeInTheDocument();
  });
  it("uses Radar as the visible destination name", () => {
    const { container } = renderWithRouter(
      <HomeUpcomingSection
        previewItems={PREVIEW_ITEMS}
        summary={{
          followed_artists: 1,
          show_count: 1,
          release_count: 0,
          attending_count: 0,
          insight_count: 0,
        }}
        onOpenUpcoming={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Radar" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Radar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-home-slot="radar-feature"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-home-slot="radar-list"]'),
    ).not.toBeInTheDocument();
  });

  it("does not repeat the featured event in the next-up list", () => {
    renderWithRouter(
      <HomeUpcomingSection
        previewItems={MULTIPLE_PREVIEW_ITEMS}
        onOpenUpcoming={vi.fn()}
      />,
    );

    expect(screen.getAllByText("First release")).toHaveLength(1);
    expect(screen.getByText("Third release")).toBeInTheDocument();
  });

  it("keeps the Radar rail visible when there are no upcoming events", () => {
    renderWithRouter(
      <HomeUpcomingSection previewItems={[]} onOpenUpcoming={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Radar" })).toBeInTheDocument();
    expect(
      screen.getByText("Follow some artists to unlock Radar"),
    ).toBeInTheDocument();
  });

  it("explains that Radar has no signals when followed artists have no events", () => {
    renderWithRouter(
      <HomeUpcomingSection
        previewItems={[]}
        summary={{
          followed_artists: 100,
          show_count: 0,
          release_count: 0,
          attending_count: 0,
          insight_count: 0,
        }}
        onOpenUpcoming={vi.fn()}
      />,
    );

    expect(screen.getByText("No new Radar signals yet")).toBeInTheDocument();
    expect(
      screen.queryByText("Follow some artists to unlock Radar"),
    ).not.toBeInTheDocument();
  });
});

function renderWithRouter(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="en">{ui}</I18nProvider>
    </MemoryRouter>,
  );
}
