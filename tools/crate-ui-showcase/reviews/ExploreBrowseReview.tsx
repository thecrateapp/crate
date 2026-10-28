import { useState } from "react";
import { MemoryRouter } from "react-router";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import {
  BrowseDetailFrame,
  BrowseReadState,
  ExploreDecades,
  ExploreFeatureCard,
  ExploreMoodChoices,
} from "../../../app/listen/src/components/explore/ExploreBrowseViews";
import { GenreTileView } from "../../../app/listen/src/components/explore/GenreTileView";
import { GenreHeroView } from "../../../app/listen/src/components/explore/GenreHeroView";
import { exploreSelectionLocation } from "../../../app/listen/src/components/explore/explore-navigation";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { HeroActionBar } from "@crate/ui/domain/hero";
import { EmptyState } from "@crate/ui/domain/states";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MoreHorizontal, Play, Share2, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
import { useGenreTileArtwork } from "../../../app/listen/src/components/explore/use-genre-tile-artwork";

type ReadState = "ready" | "loading" | "error" | "empty";
function ArtworkRecovery() {
  const [candidates, setCandidates] = useState([IMAGE_SAMPLES[0]!]);
  const artwork = useGenreTileArtwork(candidates);
  const brokenImage = "data:image/png;base64,YmFk";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GenreTileView
        variant="related"
        name="Artwork recovery"
        kicker="Related"
        detail="Real fallback lifecycle"
        renderImage={
          artwork.url
            ? (className) => (
                <img
                  src={artwork.url!}
                  alt=""
                  className={className}
                  onError={artwork.onError}
                />
              )
            : undefined
        }
        onOpen={() => {}}
      />
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCandidates([brokenImage, IMAGE_SAMPLES[1]!])}
          >
            Fail first artwork
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCandidates([brokenImage])}
          >
            Exhaust artwork
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setCandidates([IMAGE_SAMPLES[0]!])}
          >
            Recover artwork
          </Button>
        </div>
        <output aria-live="polite" aria-label="Artwork status">
          {artwork.url === IMAGE_SAMPLES[0]
            ? "Primary artwork"
            : artwork.url
              ? "Fallback artwork"
              : "No artwork"}
        </output>
      </div>
    </div>
  );
}
function Scene() {
  const [read, setRead] = useState<ReadState>("ready");
  const [pending, setPending] = useState<string | null>(null);
  const [event, setEvent] = useState("No action yet");
  const [artwork, setArtwork] = useState(true);
  const [location, setLocation] = useState({
    pathname: "/explore",
    search: "?keep=one&keep=two",
    hash: "#browse",
  });
  const open = (
    key?: "genre" | "decade" | "playlistCategory",
    value?: string,
  ) => {
    const next = exploreSelectionLocation(location, key, value);
    setLocation(next);
    setEvent(`${next.pathname}${next.search}${next.hash}`);
  };
  const radio = () => {
    setPending("radio");
    setEvent("Radio requested in fixture");
  };
  return (
    <main className="mx-auto grid max-w-6xl gap-10 p-4 sm:p-6">
      <PageHeader
        title="Explore and browse"
        eyebrow="1BC · First batch"
        subtitle="Actual Listen views. Local fixture actions; production data and playback remain in their controllers."
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Read state">
          {(props) => (
            <Select
              value={read}
              onValueChange={(value) => setRead(value as ReadState)}
            >
              <SelectTrigger {...props}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ready", "loading", "error", "empty"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setPending(null);
            setEvent("Pending request completed");
          }}
        >
          Complete request
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => setArtwork(!artwork)}
        >
          {artwork ? "Hide artwork" : "Show artwork"}
        </Button>
      </div>
      <output aria-live="polite" aria-label="Fixture event">
        {event}
      </output>
      <FormField kind="group" label="Landing · existing discovery destinations">
        {(props) => (
          <div {...props} role="group" className="grid gap-3 sm:grid-cols-2">
            <ExploreFeatureCard
              title="Radio"
              subtitle="Start from a track, artist, album or genre."
              onClick={() => setEvent("Open /radio")}
            />
            <ExploreFeatureCard
              title="Paths"
              subtitle="Find the route between scenes, artists and records."
              onClick={() => setEvent("Open /paths")}
            />
          </div>
        )}
      </FormField>
      <FormField
        kind="group"
        label="Genre rooms and related genres · managed artwork is injected"
      >
        {(props) => (
          <div {...props} role="group" className="grid gap-4 sm:grid-cols-3">
            <GenreTileView
              variant="room"
              name="Mathcore"
              kicker="Genre room"
              detail="Angular hardcore, odd meters and controlled chaos."
              renderImage={
                artwork
                  ? (className) => (
                      <img
                        className={className}
                        src={IMAGE_SAMPLES[0]}
                        alt=""
                      />
                    )
                  : undefined
              }
              onOpen={() => open("genre", "mathcore")}
            />
            <GenreTileView
              variant="related"
              name="Punk / Hardcore"
              kicker="Parent"
              detail="12 artists · 0 albums"
              renderImage={
                artwork
                  ? (className) => (
                      <img
                        className={className}
                        src={IMAGE_SAMPLES[1]}
                        alt=""
                      />
                    )
                  : undefined
              }
              onOpen={() => open("genre", "punk-hardcore")}
              actions={
                <div className="absolute right-2 top-2">
                  <ActionGroup label="Related genre actions">
                    <ActionButton
                      label="More Punk / Hardcore actions"
                      tooltip="More"
                      onClick={() => setEvent("Genre menu requested")}
                    >
                      <MoreHorizontal size={CRATE_ICON_SIZE.md} />
                    </ActionButton>
                  </ActionGroup>
                </div>
              }
            />
            <GenreTileView
              variant="related"
              name="An unusually long genre name that must remain readable"
              kicker="Related"
              detail="0 artists · 0 albums"
              onOpen={() => open("genre", "long-genre")}
            />
          </div>
        )}
      </FormField>
      <FormField kind="group" label="Artwork failure and recovery">
        {(props) => (
          <div {...props} role="group">
            <ArtworkRecovery />
          </div>
        )}
      </FormField>
      <FormField kind="group" label="Decade actions and mood playback choices">
        {(props) => (
          <div {...props} role="group" className="grid gap-6">
            <ExploreDecades
              decades={["1980s", "1990s", "2000s"]}
              onOpen={(decade) => open("decade", decade)}
            />
            <ExploreMoodChoices
              moods={[
                { name: "dark", track_count: 0 },
                { name: "chill", track_count: 24 },
                { name: "energetic", track_count: 8 },
              ]}
              pending={pending}
              onPlay={(name) => {
                setPending(name);
                setEvent(`Play ${name} mix requested`);
              }}
            />
          </div>
        )}
      </FormField>
      <FormField
        kind="group"
        label="Genre hero · original gradient and approved image offset"
      >
        {(props) => (
          <div {...props} role="group" className="overflow-hidden">
            <GenreHeroView
              name="Mathcore"
              description="Angular hardcore, odd meters and controlled chaos. Descriptions retain their natural case."
              artistCount={12}
              albumCount={0}
              trackCount={84}
              renderImage={
                artwork
                  ? (className) => (
                      <img
                        className={className}
                        src={IMAGE_SAMPLES[0]}
                        alt=""
                      />
                    )
                  : undefined
              }
              actions={
                <HeroActionBar
                  primaryLabel="Genre playback"
                  primaryActions={[
                    {
                      key: "radio",
                      label: "Play",
                      ariaLabel: "Play genre radio",
                      icon: (
                        <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
                      ),
                      loading: pending === "radio",
                      onClick: radio,
                    },
                  ]}
                  secondaryLabel="Genre actions"
                  secondaryActions={[
                    {
                      key: "share",
                      label: "Share",
                      icon: <Share2 size={CRATE_ICON_SIZE.lg} />,
                      onClick: () => setEvent("Share genre requested"),
                    },
                  ]}
                />
              }
            />
          </div>
        )}
      </FormField>
      <FormField
        kind="group"
        label="Decade and category details · loading, error, empty and zero"
      >
        {(props) => (
          <div {...props} role="group" className="grid gap-8 sm:grid-cols-2">
            {[
              ["1990s", "0 artists"],
              ["LoFi / DIY", "0 playlists"],
            ].map(([title, count]) => (
              <BrowseDetailFrame
                key={title}
                title={title}
                count={read === "ready" || read === "empty" ? count : undefined}
                onBack={() => open()}
              >
                <BrowseReadState
                  loading={read === "loading"}
                  error={read === "error" ? "unavailable" : null}
                  onRetry={() => {
                    setRead("ready");
                    setEvent("Read retried");
                  }}
                />
                {read === "ready" ? (
                  <MonoLabel>
                    No manufactured counts or search results
                  </MonoLabel>
                ) : read === "empty" ? (
                  <EmptyState
                    variant="dashed"
                    message="No results in this fixture"
                  />
                ) : null}
              </BrowseDetailFrame>
            ))}
          </div>
        )}
      </FormField>
    </main>
  );
}
export function ExploreBrowseReview() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Scene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
