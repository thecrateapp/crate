import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { ReleaseRow } from "./ReleaseRow";
import { ShowCard } from "./ShowCard";
import type { UpcomingItem } from "./upcoming-types";

const show: UpcomingItem = {
  id: 42,
  event_key: "show-42",
  type: "show",
  date: "2030-01-20",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "The Forum",
  subtitle: "London",
  venue: "The Forum",
  city: "London",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
};
const release: UpcomingItem = {
  ...show,
  type: "release",
  title: "No Heroes",
  subtitle: "Album",
  album_id: 12,
  album_slug: "no-heroes",
};

describe("Upcoming event presentation", () => {
  afterEach(() => vi.useRealTimers());

  it("shares an unboxed countdown between shows and pre-releases", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-02T23:59:59"));
    renderWithListenProviders(
      <>
        <ShowCard item={show} />
        <ReleaseRow item={release} />
      </>,
    );
    const labels = screen.getAllByText("18 days to go");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.closest('[data-slot="upcoming-timing"]')).toHaveClass(
        "font-mono",
        "uppercase",
      );
      expect(label.closest('[data-slot="info-badge"]')).toBeNull();
    }
    expect(screen.queryByText("Pre-release")).not.toBeInTheDocument();
  });

  it("uses only a grey Released caption and keeps its date in the date stamp", () => {
    renderWithListenProviders(
      <ReleaseRow item={{ ...release, is_upcoming: false }} />,
    );
    const status = screen.getByText("Released");
    expect(status).toHaveClass("font-mono", "uppercase", "text-text-subtle");
    expect(status.closest('[data-slot="info-badge"]')).toBeNull();
    expect(screen.queryByText(/Released on/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sunday, January 20, 2030")).toHaveAttribute(
      "datetime",
      "2030-01-20",
    );
  });

  it("shares the date and artwork frame between compact shows and releases", () => {
    renderWithListenProviders(
      <>
        <ShowCard item={show} />
        <ReleaseRow item={release} />
      </>,
    );
    const dates = screen.getAllByLabelText("Sunday, January 20, 2030");
    expect(dates).toHaveLength(2);
    for (const date of dates) {
      expect(date).toHaveAttribute("datetime", "2030-01-20");
      expect(date).toHaveAttribute("data-slot", "upcoming-date");
      expect(within(date).getByText("Jan")).toHaveClass(
        "uppercase",
        "font-mono",
      );
      expect(within(date).getByText("20")).toHaveClass("font-display");
      expect(
        date
          .closest('[data-slot="upcoming-event-row"]')
          ?.querySelector('[data-slot="media-cover"]'),
      ).toHaveClass("size-[88px]");
    }
    expect(screen.queryByText("Pre-release")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open No Heroes" }).closest("article"),
    ).not.toHaveClass("upcoming-event-row-atmosphere");
  });

  it("keeps translated status captions without a duplicate date or synthetic countdown", () => {
    renderWithListenProviders(
      <ReleaseRow item={{ ...release, date: "", is_upcoming: false }} />,
      { locale: "es" },
    );
    expect(screen.getByText("Publicado")).toHaveClass("uppercase", "font-mono");
    expect(screen.queryByText(/\d+.*(?:days|días)/i)).not.toBeInTheDocument();
  });

  it.each(["", "invalid", "2030-02-31", "2029-01-01"])(
    "omits an unknown or elapsed pre-release countdown (%s)",
    (date) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2030-01-02T12:00:00"));
      const { container } = renderWithListenProviders(
        <ReleaseRow item={{ ...release, date }} />,
      );
      expect(
        container.querySelector('[data-slot="upcoming-timing"]'),
      ).toBeNull();
      expect(screen.queryByText("Pre-release")).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Open No Heroes" }),
      ).toBeInTheDocument();
    },
  );

  it("uses canonical row actions without losing attendance or expansion callbacks", async () => {
    const toggle = vi.fn();
    renderWithListenProviders(<ShowCard item={show} onToggle={toggle} />);
    const attend = screen.getByRole("button", { name: "Mark as attending" });
    expect(attend).toHaveClass("size-11");
    expect(attend.closest('[data-slot="action-group"]')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Converge.*The Forum/ }),
    );
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("disables tickets without a URL instead of providing a no-op hash link", () => {
    renderWithListenProviders(<ShowCard item={show} variant="feature" />);
    const tickets = screen.getByRole("link", { name: "Get Tickets" });
    expect(tickets).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(tickets)).toBe(false);
  });

  it("keeps zero genre and setlist percentages in the approved ticket composition", () => {
    renderWithListenProviders(
      <ShowCard
        item={{
          ...show,
          genre_profile: [{ name: "Hardcore", percent: 0, source: "tags" }],
          probable_setlist: [{ title: "Dark Horse", frequency: 0 }],
        }}
        variant="feature"
      />,
    );
    expect(screen.getByTitle("Hardcore · 0% · tags")).toHaveClass("genre-pill");
    expect(screen.getAllByText("0%")).toHaveLength(2);
  });
});
