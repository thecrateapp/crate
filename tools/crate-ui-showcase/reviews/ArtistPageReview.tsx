import "../../../app/listen/src/components/layout/listen-shell-metrics.css";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { BandcampSecondaryActionView } from "../../../app/listen/src/components/bandcamp/BandcampSecondaryActionView";
import { ArtistHeroView } from "../../../app/listen/src/components/artist/ArtistHeroView";
import { ArtistHeroActionsView } from "../../../app/listen/src/components/artist/ArtistHeroActionsView";
import { ArtistReadState } from "../../../app/listen/src/components/artist/ArtistReadState";
import {
  ArtistAlbumGroupFrame,
  ArtistCommunityGroupFrame,
  ArtistTopTracksFrame,
} from "../../../app/listen/src/components/artist/ArtistLibraryFrames";
import { ArtistShowPrepView } from "../../../app/listen/src/components/artist/ArtistShowPrepView";
import { ArtistSetlistView } from "../../../app/listen/src/components/artist/ArtistSetlistView";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ArtistBioProfile } from "@crate/ui/domain/ArtistBioProfile";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { AppModal } from "@crate/ui/primitives/AppModal";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { ARTIST_BIO_FIXTURE } from "./ArtistComponentsReview";
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
type State = "ready" | "loading" | "error" | "not found" | "sparse";
function ArtistScene() {
  const [read, setRead] = useState<State>("ready"),
    [artwork, setArtwork] = useState(true),
    [following, setFollowing] = useState(false);
  const [bio, setBio] = useState(false),
    [setlist, setSetlist] = useState(false),
    [saving, setSaving] = useState(false),
    [expanded, setExpanded] = useState(true);
  const [event, setEvent] = useState("No action yet");
  const [activeTrack, setActiveTrack] = useState<number | null>(null);
  const sparse = read === "sparse";
  const [longName, setLongName] = useState(false);
  const [bandcampOwned, setBandcampOwned] = useState(false);
  const name = longName
    ? "Nocturnal Ensemble and the Extraordinary Orchestra of the Very Long Night"
    : "Nocturnal Ensemble";
  return (
    <main className="mx-auto grid max-w-6xl gap-10 p-4 sm:p-6">
      <PageHeader
        title="Artist"
        eyebrow="1BC · Second batch"
        subtitle="Actual Listen artist views and existing shared editorial components. Local actions; no API or audio writes."
      />
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Read state">
          {(props) => (
            <Select
              value={read}
              onValueChange={(value) => setRead(value as State)}
            >
              <SelectTrigger {...props}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ready", "loading", "error", "not found", "sparse"].map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <Button
          variant="outline"
          size="lg"
          onClick={() => setArtwork(!artwork)}
        >
          {artwork ? "Hide artwork" : "Show artwork"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setSaving(false);
            setEvent("Export completed in fixture");
          }}
        >
          Complete export
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setLongName(!longName)}>
          {longName ? "Use short artist name" : "Use long artist name"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setBandcampOwned(!bandcampOwned)}
        >
          {bandcampOwned ? "Show Bandcamp action" : "Show Bandcamp owned"}
        </Button>
      </div>
      <output aria-live="polite" aria-label="Artist fixture event">
        {event}
      </output>
      {read !== "ready" && !sparse ? (
        <ArtistReadState
          loading={read === "loading"}
          error={read === "error" ? "Read failed" : null}
          status={read === "not found" ? 404 : 503}
          onRetry={() => {
            setRead("ready");
            setEvent("Artist retried");
          }}
        />
      ) : (
        <>
          <FormField
            kind="group"
            label="Artist hero · managed image adapter and actual secondary actions"
          >
            {(group) => (
              <div {...group} role="group">
                <ArtistHeroView
                  name={name}
                  bio={sparse ? "" : ARTIST_BIO_FIXTURE}
                  listeners={sparse ? undefined : 12000}
                  trackCount={sparse ? 0 : 84}
                  albumCount={0}
                  photoUrl={artwork ? IMAGE_SAMPLES[0]! : ""}
                  backgroundUrl={artwork ? IMAGE_SAMPLES[1] : undefined}
                  renderImage={(props) => <img {...props} />}
                  onOpenBio={() => setBio(true)}
                  actions={
                    <ArtistHeroActionsView
                      mobileMenuPortal={false}
                      menu={{
                        actions: [
                          {
                            key: "share",
                            label: "Share",
                            onSelect: () =>
                              setEvent("Share from menu requested"),
                          },
                        ],
                        sheetLabel: "Artist actions",
                      }}
                      supportAction={
                        <BandcampSecondaryActionView
                          owned={bandcampOwned}
                          busy={false}
                          label={
                            bandcampOwned
                              ? "Owned on Bandcamp"
                              : "Support on Bandcamp"
                          }
                          onActivate={() => setEvent("Bandcamp requested")}
                        />
                      }
                      following={following}
                      hasSetlist={!sparse}
                      onPlay={() => setEvent("Play artist requested")}
                      onShuffle={() => setEvent("Shuffle artist requested")}
                      onArtistRadio={() => setEvent("Artist radio requested")}
                      onPlaySetlist={() => setSetlist(true)}
                      onToggleFollow={() => {
                        setFollowing(!following);
                        setEvent(
                          following ? "Unfollow requested" : "Follow requested",
                        );
                      }}
                      onShare={() => setEvent("Share artist requested")}
                    />
                  }
                />
              </div>
            )}
          </FormField>
          <FormField
            kind="group"
            label="Top tracks · original playback and fixed metadata slots"
          >
            {(group) => (
              <div {...group} role="group">
                <ArtistTopTracksFrame
                  title="Top Tracks"
                  actionLabel="View all"
                  onAction={() => setEvent("Open all artist tracks")}
                >
                  <TrackList
                    items={[1, 2]}
                    itemKey={(track) => track}
                    renderRow={(track) => (
                      <TrackRowView
                        aria-label={`Night track ${track}`}
                        active={activeTrack === track}
                      >
                        <TrackRowContent
                          title={`Night track ${track}`}
                          details={
                            <span className="text-xs text-text-muted">
                              Night Music
                            </span>
                          }
                          quality={{
                            label: "FLAC 24/96",
                            tier: "hi-res",
                            detail: "FLAC 24-bit / 96 kHz",
                          }}
                          tempo={track === 1 ? "76" : "136"}
                          musicalKey="7B"
                          duration="6:04"
                          actions={null}
                          leading={
                            <TrackRowPlaybackControl
                              index={track}
                              disabled={false}
                              isActive={activeTrack === track}
                              isPlaying={activeTrack === track}
                              label={`Play Night track ${track}`}
                              onClick={() => {
                                setActiveTrack(
                                  activeTrack === track ? null : track,
                                );
                                setEvent(`Preview track ${track} requested`);
                              }}
                              artwork={
                                <MediaCover
                                  src={artwork ? IMAGE_SAMPLES[0] : undefined}
                                  alt=""
                                  className="absolute inset-0 size-full"
                                />
                              }
                              activeGlyph={
                                activeTrack === track ? (
                                  <TrackRowPlaybackProgressView
                                    isPlaying
                                    currentTime={20}
                                    duration={100}
                                  />
                                ) : undefined
                              }
                            />
                          }
                        />
                      </TrackRowView>
                    )}
                  />
                </ArtistTopTracksFrame>
              </div>
            )}
          </FormField>
          <FormField kind="group" label="Discography · original V2 image scale">
            {(group) => (
              <div {...group} role="group">
                <ArtistAlbumGroupFrame title="Albums">
                  {Array.from({ length: 6 }, (_, index) => (
                    <EntityCard
                      key={index}
                      title={`Night music ${index + 1}`}
                      layout="grid"
                      cover={{
                        src: artwork ? IMAGE_SAMPLES[index % 2] : undefined,
                        alt: "",
                      }}
                      subtitle={<MonoLabel as="span">{2026 - index}</MonoLabel>}
                      menuButton="none"
                      onOpen={() => setEvent(`Open album ${index + 1}`)}
                    />
                  ))}
                </ArtistAlbumGroupFrame>
              </div>
            )}
          </FormField>
          <FormField
            kind="group"
            label="Artist community · SectionHeader and retained card scale"
          >
            {(group) => (
              <div {...group} role="group">
                <ArtistCommunityGroupFrame title="Related Artists">
                  {[
                    "A very long artist name that remains readable",
                    "Mixed Case Artist",
                    "Local artist",
                  ].map((artist, index) => (
                    <EntityCard
                      key={artist}
                      title={artist}
                      layout="grid"
                      shape="circle"
                      cover={{
                        src: artwork ? IMAGE_SAMPLES[index % 2] : undefined,
                        alt: "",
                      }}
                      subtitle={
                        <MonoLabel as="span">
                          {index === 0 ? "0% match" : "84% match"}
                        </MonoLabel>
                      }
                      menuButton="none"
                      onOpen={() => setEvent(`Open ${artist}`)}
                    />
                  ))}
                </ArtistCommunityGroupFrame>
              </div>
            )}
          </FormField>
          <FormField
            kind="group"
            label="Attending a show · solid preparation card"
          >
            {(group) => (
              <div {...group} role="group">
                <ArtistShowPrepView
                  title="A venue with an unusually long name, in a city with a long name"
                  context="Bristol, United Kingdom · October 24, 2026"
                  hasSetlist={!sparse}
                  onPlay={() => setEvent("Play probable setlist requested")}
                  onDetails={() => {
                    setSetlist(true);
                    setEvent("Show details requested");
                  }}
                />
              </div>
            )}
          </FormField>
          <FormField
            kind="group"
            label="Biography and probable setlist · real modal and readout"
          >
            {(group) => (
              <div {...group} role="group" className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => setBio(true)}>
                  Open biography
                </Button>
                <Button variant="outline" onClick={() => setSetlist(true)}>
                  Open setlist
                </Button>
              </div>
            )}
          </FormField>
        </>
      )}
      <AppModal
        open={bio}
        onClose={() => setBio(false)}
        ariaLabel={`${name} biography`}
        size="xl"
        panelClassName="flex min-h-0 flex-col sm:max-h-[92vh]"
        mobileSafeArea
      >
        <ArtistBioProfile
          artistName={name}
          photoUrl={artwork ? IMAGE_SAMPLES[0] : undefined}
          meta={["Since 1991", "Bristol, United Kingdom"]}
          bio={ARTIST_BIO_FIXTURE}
          bioExpanded={expanded}
          onBioToggle={() => setExpanded(!expanded)}
          genres={[
            { name: "trip-hop", percent: 74, source: "lastfm" },
            { name: "experimental", percent: 0, source: "lastfm" },
          ]}
          stats={{ listeners: 12000, spotifyPopularity: 0 }}
          libraryStats={{ albums: 0, tracks: 84, sizeMb: 1200 }}
          members={[
            { name: "Alex Example", roles: ["vocals"], begin: "1991-10" },
            {
              name: "Former Member",
              roles: ["drums"],
              begin: "1990",
              end: "1998-08-28",
            },
          ]}
          urls={[{ type: "official homepage", url: "https://example.com" }]}
          onExternalLink={() => setEvent("External biography link requested")}
          onGenreSelect={(genre) => setEvent(`Genre ${genre.name} requested`)}
          onClose={() => setBio(false)}
        />
      </AppModal>
      <ArtistSetlistView
        artistName={name}
        setlist={[
          { title: "Natural Case Song Title", frequency: 0.8, play_count: 12 },
          {
            title:
              "A long song title that remains readable across a small screen",
            frequency: 0,
            play_count: 0,
          },
        ]}
        open={setlist}
        saving={saving}
        canExport
        onClose={() => setSetlist(false)}
        onPlay={() => {
          setSetlist(false);
          setEvent("Play setlist requested");
        }}
        onExport={() => {
          setSaving(true);
          setEvent("Export requested in fixture");
        }}
      />
    </main>
  );
}
export function ArtistPageReview() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <ArtistScene />
      </I18nextProvider>
    </MemoryRouter>
  );
}
