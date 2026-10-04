import {
  fireEvent,
  render as renderTestingLibrary,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openShareSheet = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());

vi.mock("@/lib/social-share", () => ({ openShareSheet }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api, getApiBase: vi.fn(() => "") };
});

import { CrateCard } from "@/components/CrateCard";
import { I18nProvider } from "@/i18n";
import { longPress, pressMenuKey } from "@/test/item-action-gestures";

function render(element: ReactElement) {
  return renderTestingLibrary(
    <MemoryRouter initialEntries={["/collection"]}>
      <Routes>
        <Route path="/collection" element={element} />
        <Route path="/crate/:crateRef" element={<p>Crate detail page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

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
  follower_count: 0,
  is_followed: false,
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
    api.mockReset();
    api.mockResolvedValue({ ok: true });
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
          onEdit={vi.fn()}
          onPlay={onPlay}
        />
      </I18nProvider>,
    );

    expect(screen.queryByText("First record")).toBeNull();
    expect(screen.getByText("01")).toBeVisible();
    expect(screen.getByText("2 albums · 4 tracks")).toBeVisible();
    expect(screen.queryByTestId("crate-visibility")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Play Year-end records" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));

    expect(screen.queryByText("Second record")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Play Year-end records" }),
    );
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("opens the Crate detail from the card instead of the editor", () => {
    const onEdit = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={onEdit} />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("link", { name: "Open Year-end records" }),
    );

    expect(screen.getByText("Crate detail page")).toBeVisible();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("hides the play button when the Crate is empty", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{ ...crate, album_count: 0, albums: [] }}
          onPlay={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Play Year-end records" }),
    ).toBeNull();
  });

  it("labels visibility and access for screen readers", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={{ ...crate, visibility: "private" }} />
      </I18nProvider>,
    );

    expect(screen.getByRole("img", { name: "Private" })).toBeVisible();
    expect(screen.getByText("Private")).toBeVisible();
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
          onEdit={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));
    fireEvent.click(screen.getByRole("button", { name: "Next album" }));

    expect(screen.queryByText("First record")).toBeNull();
  });

  it("omits ranking overlays for unordered Crates", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={{ ...crate, is_ordered: false }} onEdit={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.queryByText("01")).toBeNull();
  });

  it("follows another user's public Crate from the menu without rethrowing", async () => {
    api.mockRejectedValueOnce(new Error("boom"));
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={{ ...crate, access: "public" }} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Follow" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/crates/crate-1/follow", "POST"),
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Follow" })).toBeVisible();
  });

  it("starts on the highest number when ordered descending", () => {
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
                position: 4,
              },
            ],
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("02")).toBeVisible();
    expect(screen.queryByText("05")).toBeNull();
  });

  it("exposes the complete working contextual action set", () => {
    const onPlay = vi.fn();
    const onShuffle = vi.fn();
    const onStartRadio = vi.fn();
    const onMakeAvailableOffline = vi.fn();
    const onDownload = vi.fn();
    const onEdit = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={crate}
          onEdit={onEdit}
          onPlay={onPlay}
          onShuffle={onShuffle}
          onStartRadio={onStartRadio}
          onMakeAvailableOffline={onMakeAvailableOffline}
          onDownload={onDownload}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getByRole("menuitem", { name: "Play Crate" })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Shuffle Crate" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Edit Crate" })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Start Crate radio" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Make available offline" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Download Crate ZIP" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Share Crate" })).toBeVisible();

    const menuActions = [
      ["Play Crate", onPlay],
      ["Shuffle Crate", onShuffle],
      ["Edit Crate", onEdit],
      ["Start Crate radio", onStartRadio],
      ["Make available offline", onMakeAvailableOffline],
      ["Download Crate ZIP", onDownload],
    ] as const;
    for (const [index, [label, callback]] of menuActions.entries()) {
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(callback).toHaveBeenCalledOnce();
      if (index < menuActions.length - 1) {
        fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      }
    }

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share Crate" }));
    expect(openShareSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "crate",
        title: "Year-end records",
        url: expect.stringContaining("/share/crate/crate-1"),
      }),
    );
  });

  it("runs the edit callback from the contextual menu", () => {
    const onEdit = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={onEdit} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Edit Crate" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Crate" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("only exposes Edit for users with edit access", () => {
    const onEdit = vi.fn();
    const privateOwner = render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{ ...crate, visibility: "private" }}
          onEdit={onEdit}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByTestId("crate-visibility")).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Share Crate" })).toBeNull();
    const privateShare = screen.getByRole("menuitem", {
      name: "Share (private Crate)",
    });
    expect(privateShare).toBeDisabled();
    fireEvent.click(privateShare);
    expect(openShareSheet).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Edit Crate" })).toBeVisible();

    privateOwner.unmount();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={{ ...crate, access: "public" }} onEdit={onEdit} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Share Crate" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Edit Crate" })).toBeNull();
  });

  it("opens the contextual menu with right click, menu key and long-press", async () => {
    const first = render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={vi.fn()} />
      </I18nProvider>,
    );
    fireEvent.contextMenu(screen.getByRole("article"));
    expect(
      await screen.findByRole("menuitem", { name: "Edit Crate" }),
    ).toBeVisible();
    first.unmount();

    const second = render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={vi.fn()} />
      </I18nProvider>,
    );
    pressMenuKey(screen.getByRole("link", { name: "Open Year-end records" }));
    expect(
      await screen.findByRole("menuitem", { name: "Edit Crate" }),
    ).toBeVisible();
    second.unmount();

    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={vi.fn()} />
      </I18nProvider>,
    );
    await longPress(screen.getByRole("article"));
    expect(
      await screen.findByRole("dialog", { name: "Actions menu" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Crate detail page")).toBeNull();
  });

  it("renders a row variant with the same link and menu", () => {
    const onEdit = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <CrateCard
          crate={{ ...crate, visibility: "private" }}
          variant="row"
          onEdit={onEdit}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("link", { name: "Open Year-end records" }),
    ).toHaveAttribute("href", expect.stringContaining("/crate/"));
    expect(screen.getByRole("img", { name: "Private" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next album" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Crate" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("keeps carousel arrows outside the primary link", () => {
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
          onPlay={vi.fn()}
        />
      </I18nProvider>,
    );

    const link = screen.getByRole("link", { name: "Open Year-end records" });
    for (const name of ["Next album", "Previous album", "More actions"]) {
      expect(link.contains(screen.getByRole("button", { name }))).toBe(false);
    }
  });

  it("reflects the menu state on the trigger", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onEdit={vi.fn()} />
      </I18nProvider>,
    );

    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
