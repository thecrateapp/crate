// Actual Listen hero consumers under their existing full-bleed/overlay-header composition.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { ArtistHeroSection } from "../src/components/artist/ArtistHeroSection";
import { GenreHero } from "../src/components/explore/GenreDetailHero";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import "../src/index.css";
applyCrateIdentity();
const noop = () => {};
const genre = {
  id: 1,
  name: "Dark jazz",
  slug: "dark-jazz",
  artists: [],
  albums: [],
};
const artist = {
  name: "The Lovecraft Sextet",
  total_tracks: 35,
  total_size_mb: 0,
  primary_format: null,
  genres: [],
  issue_count: 0,
  albums: [],
};
const isArtist = new URLSearchParams(location.search).get("kind") === "artist";
createRoot(document.getElementById("root")!).render(
  <I18nProvider initialLocale="en">
    <MemoryRouter>
      <header
        className="pointer-events-none fixed inset-x-0 top-0 z-app-header h-20 bg-surface-chrome/80"
        aria-label="Overlay header"
      />
      <main className="overflow-x-hidden px-4 sm:px-6">
        {isArtist ? (
          <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
            <ArtistHeroSection
              artist={artist}
              artistInfo={{
                bio: "A musical project with a description that wraps across multiple lines, preserving its identity above the track collection.",
                tags: [],
                similar: [],
                listeners: 15500,
                playcount: 0,
                image_url: null,
                url: "",
              }}
              photoUrl=""
              tags={[]}
              following
              onPlay={noop}
              onShuffle={noop}
              onArtistRadio={noop}
              onToggleFollow={noop}
              onShare={noop}
              onOpenBio={noop}
            />
          </div>
        ) : (
          <GenreHero
            data={genre}
            description="Explore the artists, albums and tracks in this genre."
            artistCount={35}
            albumCount={8}
            trackCount={200}
            heroCoverUrl={null}
            onCoverError={noop}
            actionBar={{
              data: genre,
              artistCount: 35,
              albumCount: 8,
              genreMenuActions: [],
              heroCoverUrl: null,
              isDesktop: true,
              nextShow: null,
              onOpenGenreRadar: noop,
              onPlayGenreRadio: noop,
              onShareGenre: noop,
              startingRadio: false,
            }}
          />
        )}
        <h2>Collection content</h2>
      </main>
    </MemoryRouter>
  </I18nProvider>,
);
