import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openShareSheet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/social-share", () => ({ openShareSheet }));

import { CrateCard } from "@/components/CrateCard";
import { I18nProvider } from "@/i18n";

const crate = {
  id: "crate-1",
  owner_id: 1,
  owner_name: "Listener",
  name: "Year-end records",
  description: "",
  visibility: "public" as const,
  is_collaborative: false,
  is_ordered: true,
  sort_direction: "asc" as const,
  loop_enabled: false,
  access: "owner" as const,
  album_count: 1,
  track_count: 4,
  first_album: null,
  albums: [
    {
      global_album_uid: "album-1",
      position: 0,
      name: "First record",
      artist_name: "Listener",
      year: "2026",
      has_cover: false,
    },
  ],
};

describe("CrateCard", () => {
  beforeEach(() => {
    openShareSheet.mockReset();
  });

  it("presents the active album with play and navigation controls", () => {
    const onPlay = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{
            ...crate,
            album_count: 2,
            albums: [
              ...crate.albums,
              {
                global_album_uid: "album-2",
                artist_name: "Listener",
                year: "2026",
                has_cover: false,
                name: "Second record",
                position: 1,
              },
            ],
          }}
          onOpen={vi.fn()}
          onEdit={vi.fn()}
          onPlay={onPlay}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("First record")).toBeVisible();
    expect(screen.getByText("2 albums · 4 tracks")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Play Year-end records" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));

    expect(screen.getByText("Second record")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Play Year-end records" }),
    );
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ global_album_uid: "album-2" }),
    );
  });

  it("wraps album navigation when loop playback is enabled", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{
            ...crate,
            loop_enabled: true,
            album_count: 2,
            albums: [
              ...crate.albums,
              {
                global_album_uid: "album-2",
                artist_name: "Listener",
                year: "2026",
                has_cover: false,
                name: "Second record",
                position: 1,
              },
            ],
          }}
          onOpen={vi.fn()}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));
    fireEvent.click(screen.getByRole("button", { name: "Next album" }));

    expect(screen.getByText("First record")).toBeVisible();
  });

  it("starts on the highest position when ordered descending", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{
            ...crate,
            is_ordered: true,
            sort_direction: "desc",
            album_count: 2,
            albums: [
              ...crate.albums,
              {
                global_album_uid: "album-2",
                artist_name: "Listener",
                year: "2026",
                has_cover: false,
                name: "Second record",
                position: 1,
              },
            ],
          }}
          onOpen={vi.fn()}
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Second record")).toBeVisible();
  });

  it("exposes contextual actions alongside the crate card", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onOpen={onOpen} onEdit={onEdit} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(
      screen.getByRole("menuitem", { name: "Open Year-end records" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Share Crate" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Edit Crate" })).toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "Share Crate" }));
    expect(openShareSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "crate",
        title: "Year-end records",
        url: expect.stringContaining("/share/crate/crate-1"),
      }),
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("runs the open and edit callbacks from the contextual menu", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const view = render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onOpen={onOpen} onEdit={onEdit} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open Year-end records" }),
    );
    expect(onOpen).toHaveBeenCalledOnce();

    view.unmount();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onOpen={onOpen} onEdit={onEdit} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Crate" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("only exposes Edit for users with edit access", () => {
    const onEdit = vi.fn();
    const privateOwner = render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{ ...crate, visibility: "private" }}
          onOpen={vi.fn()}
          onEdit={onEdit}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Share Crate" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Edit Crate" })).toBeVisible();

    privateOwner.unmount();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{ ...crate, access: "public" }}
          onOpen={vi.fn()}
          onEdit={onEdit}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Share Crate" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Edit Crate" })).toBeNull();
  });
});
