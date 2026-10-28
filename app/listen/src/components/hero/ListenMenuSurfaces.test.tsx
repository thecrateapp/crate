import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { AlbumActions } from "../album/AlbumActions";
import { ListenHeroActionBar } from "./ListenHeroActionBar";

let desktop = true;
vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => desktop,
}));
vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => desktop,
}));
vi.mock("@/components/bandcamp/BandcampSupportButton", () => ({
  BandcampSupportButton: () => null,
}));

it.each([true, false])(
  "playlist/crate/genre and album adapters retain the solid menu and managed artwork (desktop: %s)",
  (isDesktop) => {
    desktop = isDesktop;
    const items = [{ key: "share", label: "Share", onSelect: vi.fn() }];
    const album = {
      artist: "High Vis",
      name: "Blending",
      display_name: "Blending",
      path: "",
      track_count: 1,
      total_size_mb: 10,
      total_length_sec: 180,
      has_cover: true,
      cover_file: null,
      tracks: [],
      genres: [],
      album_tags: {
        artist: "High Vis",
        album: "Blending",
        year: "2022",
        genre: "",
        musicbrainz_albumid: null,
      },
    };
    const { unmount } = render(
      <I18nProvider initialLocale="en">
        <AlbumActions
          data={album}
          coverUrl="/cover.jpg"
          displayName="Blending"
          state={{
            isPreRelease: false,
            canPersistAlbum: false,
            canSaveAlbum: false,
            offlineSupported: false,
            offlineState: "idle",
            offlineBusy: false,
            offlineButtonLabel: "Offline",
            offlineStatusDetail: null,
            saved: false,
            remoteOnly: false,
            playerTracksAvailable: true,
          }}
          actions={{
            onAlbumRadio: vi.fn(),
            onToggleOffline: vi.fn(),
            onToggleSaved: vi.fn(),
            onShare: vi.fn(),
            onPlay: vi.fn(),
            onShuffle: vi.fn(),
            onMenuClose: vi.fn(),
          }}
          menuItems={items}
          actionsRef={createRef()}
          t={(key) => (key === "common.more" ? "More" : key)}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    let surface = screen.getByRole("menu").closest(".crate-overlay-surface");
    expect(surface).not.toBeNull();
    expect(surface).not.toHaveClass("listen-glass-panel");
    expect(screen.getByRole("img", { name: "Blending" })).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
    unmount();

    render(
      <I18nProvider initialLocale="en">
        <ListenHeroActionBar
          mobileMenuPortal={false}
          menu={{
            actions: items,
            header: {
              type: "media",
              title: "Night music",
              imageUrl: "/playlist.jpg",
            },
          }}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    surface = screen.getByRole("menu").closest(".crate-overlay-surface");
    expect(surface).not.toBeNull();
    expect(surface).not.toHaveClass("listen-glass-panel");
    expect(screen.getByRole("img", { name: "Night music" })).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
    if (!desktop) expect(surface).toHaveClass("crate-overlay-panel");
  },
);
