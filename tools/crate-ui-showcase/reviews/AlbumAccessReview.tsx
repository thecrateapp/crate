import {
  ArtistAlbumGroupFrame,
  ArtistTopTracksFrame,
} from "../../../app/listen/src/components/artist/ArtistLibraryFrames";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { SidebarNavigationView } from "../../../app/listen/src/components/layout/ListenNavigation";
import {
  listenNavigationItems,
  collectionNavigationItems,
} from "../../../app/listen/src/components/layout/listen-navigation-model";
import "../../../app/listen/src/components/layout/listen-shell.css";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  formatTrackAnalysis,
  formatMusicalKey,
} from "@crate/ui/lib/track-meta";
import { getQualityBadge } from "../../../app/listen/src/components/player/bar/player-bar-utils";
import { QualityBadge } from "../../../app/listen/src/components/player/bar/QualityBadge";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Heart, MoreHorizontal } from "@crate/ui/icons";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { UpcomingShowExpandedView } from "../../../app/listen/src/components/upcoming/UpcomingShowExpandedView";
import { UpcomingMonthGroupView } from "../../../app/listen/src/components/upcoming/UpcomingMonthGroupView";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { Button } from "@crate/ui/shadcn/button";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { CredentialsForm } from "../../../app/listen/src/components/auth/CredentialsForm";
import { ServerSetupView } from "../../../app/listen/src/components/auth/ServerSetupView";
import { AuthCallbackView } from "../../../app/listen/src/components/auth/AuthCallbackView";
import {
  AlbumHeroFrame,
  ALBUM_MOBILE_HERO_SPACING,
} from "../../../app/listen/src/components/album/AlbumHeroFrame";
import { AlbumActionsView } from "../../../app/listen/src/components/album/AlbumActionsView";
import { AlbumSelectionToolbar } from "../../../app/listen/src/components/album/AlbumSelectionToolbar";
import { ReleaseCountdown } from "../../../app/listen/src/components/album/ReleaseCountdown";
import {
  RemoteImportView,
  type RemoteImportStatus,
} from "../../../app/listen/src/components/imports/RemoteImportView";
import { OfflineLibraryView } from "../../../app/listen/src/pages/OfflineLibraryView";
import { PlayerSeekBar } from "../../../app/listen/src/components/player/bar/PlayerSeekBar";
import {
  TrackRowPlaybackProgressView,
  TrackRowPlaybackControl,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import "../../../app/listen/src/components/player/bar/player-seek-bar.css";
import "../../../app/listen/src/components/layout/listen-shell-metrics.css";
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
function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div {...group} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}
export function AccessExamples() {
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [url, setUrl] = useState("https://api.example.test"),
    [error, setError] = useState("");
  return (
    <I18nextProvider i18n={i18n}>
      <Sample label="Access · canonical shared fields, no live authentication">
        <Button variant="outline" onClick={() => setBusy(!busy)}>
          {busy ? "Show ready access" : "Show pending access"}
        </Button>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            setError("");
          }}
        >
          <TabsList aria-label="Access views">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
            <TabsTrigger value="server">Server</TabsTrigger>
            <TabsTrigger value="callback">Callback</TabsTrigger>
          </TabsList>
          {(["login", "register"] as const).map((value) => (
            <TabsContent key={value} value={value}>
              <CredentialsForm
                embedded
                mode={value}
                email={email}
                password={password}
                name={name}
                onNameChange={setName}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                busy={busy}
                error={error}
                notice={
                  value === "register"
                    ? "Invite-only server. An invitation is required."
                    : undefined
                }
                disabled={value === "register"}
                onSubmit={(event) => {
                  event.preventDefault();
                  setError("Sample authentication error. No request was sent.");
                }}
              />
            </TabsContent>
          ))}
          <TabsContent value="server">
            <ServerSetupView
              embedded
              url={url}
              onUrlChange={setUrl}
              busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                setError("Sample probe failure. No request was sent.");
              }}
              status={error}
            />
          </TabsContent>
          <TabsContent value="callback">
            <AuthCallbackView embedded desktopDeepLink="#sample-callback" />
          </TabsContent>
        </Tabs>
      </Sample>
    </I18nextProvider>
  );
}
export function AlbumExamples() {
  const [mode, setMode] = useState("local"),
    [saved, setSaved] = useState(false),
    [offline, setOffline] = useState(false);
  const [selectedCount, setSelectedCount] = useState(2),
    [picker, setPicker] = useState(false);
  const [result, setResult] = useState("No album action yet.");
  const [status, setStatus] = useState<RemoteImportStatus>("idle"),
    [confirming, setConfirming] = useState(false);
  const remote = mode === "remote",
    future = mode === "future";
  const actions = {
    onAlbumRadio: () => setResult("Sample album radio."),
    onToggleOffline: () => {
      setOffline(!offline);
      setResult("Sample offline copy toggled. No files transferred.");
    },
    onToggleSaved: () => setSaved(!saved),
    onShare: () => setResult("Sample share."),
    onPlay: () => setResult("Sample album queued."),
    onShuffle: () => setResult("Sample album shuffled."),
    onMenuClose: () => {},
  };
  const releaseDate = new Date(Date.now() + 86400000 * 3)
    .toISOString()
    .slice(0, 10);
  return (
    <I18nextProvider i18n={i18n}>
      <Sample label="Album · real hero and actions, native placement preserved">
        <FormField label="Album state">
          {(control) => (
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value);
                setStatus("idle");
                setConfirming(false);
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local album</SelectItem>
                <SelectItem value="remote">Remote album</SelectItem>
                <SelectItem value="future">
                  Pre-release · no playable tracks
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        <div style={ALBUM_MOBILE_HERO_SPACING}>
          <AlbumHeroFrame
            title="Luz de octubre"
            subtitle="Costa Norte"
            eyebrow={
              future ? (
                <InfoBadge>Pre-release</InfoBadge>
              ) : remote ? (
                <InfoBadge>via Sample node</InfoBadge>
              ) : offline ? (
                <InfoBadge>Offline</InfoBadge>
              ) : undefined
            }
            meta={[
              "2026",
              "2 tracks",
              "6 min",
              <QualityBadge
                key="quality"
                badge={{
                  label: "FLAC 16/44.1",
                  tier: "lossless",
                  detail: "16-bit / 44.1 kHz",
                }}
              />,
            ]}
            background={{ src: IMAGE_SAMPLES[0] }}
            artwork={
              <MediaCover
                src={IMAGE_SAMPLES[0]}
                alt="Luz de octubre"
                className="size-full"
              />
            }
            actions={
              <AlbumActionsView
                t={(key, options) => String(i18n.t(key, options))}
                state={{
                  isPreRelease: future,
                  canPersistAlbum: !remote,
                  canSaveAlbum: true,
                  offlineSupported: true,
                  offlineState: offline ? "ready" : "idle",
                  offlineBusy: false,
                  offlineButtonLabel: offline
                    ? "Available offline"
                    : "Make available offline",
                  offlineStatusDetail: null,
                  saved,
                  remoteOnly: remote,
                  playerTracksAvailable: !future,
                }}
                actions={actions}
                menu={{
                  actions: [
                    {
                      key: "queue",
                      label: "Add to queue",
                      onSelect: () => setResult("Sample album added to queue."),
                    },
                  ],
                }}
              />
            }
          >
            {future ? <ReleaseCountdown releaseDate={releaseDate} /> : null}
          </AlbumHeroFrame>
        </div>
        <Sample label="Selection · canonical actions, local callbacks">
          <AlbumSelectionToolbar
            selectedCount={selectedCount}
            playlists={[{ id: 1, name: "Night listening" }]}
            selectionPlaylistPickerOpen={picker}
            onToggleSelectionPlaylistPicker={() => setPicker(!picker)}
            onCreatePlaylistFromSelection={() => {
              setPicker(false);
              setResult("Sample playlist creation.");
            }}
            onAddSelectedToPlaylist={async () => {
              setPicker(false);
              setResult("Sample tracks added to playlist.");
            }}
            onClearSelection={() => {
              setSelectedCount(0);
              setPicker(false);
            }}
          />
        </Sample>
        <p role="status" className="font-mono text-xs text-text-muted">
          {result}
        </p>
        {remote ? (
          <Sample label="Remote import · confirmed server states and explicit confirmation">
            <FormField label="Import state">
              {(control) => (
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as RemoteImportStatus)
                  }
                >
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "idle",
                      "requesting",
                      "requested",
                      "approved",
                      "downloading",
                      "verifying",
                      "importing",
                      "completed",
                      "forbidden",
                      "offline",
                      "failed",
                      "cancelled",
                    ].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <RemoteImportView
              status={status}
              progress={status === "downloading" ? 42 : null}
              estimatedSize="48 MB"
              sourceName="Sample node"
              confirming={confirming}
              onRequest={() => setConfirming(true)}
              onCancel={() => setConfirming(false)}
              onRetry={() => {
                setStatus("idle");
                setConfirming(true);
              }}
              onConfirm={() => {
                setConfirming(false);
                setStatus("requested");
              }}
            />
          </Sample>
        ) : null}
      </Sample>
    </I18nextProvider>
  );
}
export function OfflineExamples() {
  const [empty, setEmpty] = useState(false),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [index, setIndex] = useState<number | null>(null);
  const tracks = [
    {
      id: "offline:sample1",
      title: "Marea",
      artist: "Costa Norte",
      duration: 180,
    },
    {
      id: "offline:sample2",
      title: "Horizonte",
      artist: "Costa Norte",
      duration: 180,
    },
  ];
  const current = index == null ? null : tracks[index];
  return (
    <I18nextProvider i18n={i18n}>
      <Sample label="Offline · verified local tracks, no clock subscription in the list">
        <Button
          variant="outline"
          onClick={() => {
            setEmpty(!empty);
            setIndex(null);
            setPlaying(false);
          }}
        >
          Toggle empty library
        </Button>
        <OfflineLibraryView
          groups={
            empty
              ? []
              : [{ key: "album:sample", title: "Luz de octubre", tracks }]
          }
          currentTrack={current}
          isPlaying={playing}
          isBuffering={false}
          onPlay={(_group, track) => {
            setIndex(track);
            setPlaying(true);
            setTime(0);
          }}
          onPause={() => setPlaying(false)}
          onResume={() => setPlaying(true)}
          onPrevious={() => setIndex(0)}
          onNext={() => setIndex(1)}
          activeGlyph={
            <TrackRowPlaybackProgressView
              currentTime={time}
              duration={180}
              isPlaying={playing}
            />
          }
          progress={
            <PlayerSeekBar
              currentTime={time}
              duration={current ? 180 : 0}
              onSeek={setTime}
              disabled={!current}
              thin
              variant="glow"
              showTimes
            />
          }
        />
      </Sample>
    </I18nextProvider>
  );
}
export function ArtistEntryExamples() {
  const [result, setResult] = useState("No artist entry action yet.");
  return (
    <Sample label="Artist entry points · actual production frames">
      <ArtistAlbumGroupFrame title="Sample artist · Albums">
        <EntityCard
          title="Luz de octubre"
          subtitle="Costa Norte · 2026"
          layout="grid"
          cover={{ src: IMAGE_SAMPLES[0], alt: "Luz de octubre" }}
          onOpen={() => setResult("Sample artist → album.")}
        />
      </ArtistAlbumGroupFrame>
      <ArtistTopTracksFrame
        title="Sample artist · Top Tracks"
        actionLabel="View All"
        onAction={() => setResult("Sample artist → all tracks.")}
      >
        <TrackList
          role="list"
          aria-label="Sample artist top tracks"
          items={["Marea"]}
          itemKey={(track) => track}
          renderRow={(track) => (
            <TrackRowView role="listitem" aria-label={track}>
              <TrackRowContent
                title={track}
                leading={
                  <TrackRowPlaybackControl
                    disabled={false}
                    index={1}
                    isActive={false}
                    isPlaying={false}
                    label={`Play ${track} — Costa Norte`}
                    artwork={
                      <MediaCover
                        src={IMAGE_SAMPLES[0]}
                        alt={track}
                        className="size-12"
                      />
                    }
                    onClick={() => setResult("Sample artist → track playback.")}
                  />
                }
                meta="Costa Norte · Luz de octubre"
                duration="3:00"
                actions={null}
              />
            </TrackRowView>
          )}
        />
      </ArtistTopTracksFrame>
      <p role="status" className="font-mono text-xs text-text-muted">
        {result}
      </p>
    </Sample>
  );
}
export function AlbumAccessReview() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BA · review"
        title="1BA · Album, access and offline"
        subtitle="Actual Listen views with local callbacks. Production authentication, artwork and storage stay in the app."
      />
      <AlbumExamples />
      <ArtistAvatarExamples />
      <RowInteractionExamples />
      <CollectionNavigationExamples />
      <ArtistEntryExamples />
      <TrackMetadataExamples />
      <ShowGenreExamples />
      <AccessExamples />
      <OfflineExamples />
    </div>
  );
}

function CollectionNavigationContent() {
  const location = useLocation();
  const translate = (key: string) => String(i18n.t(key));
  return (
    <div className="w-52 max-w-full">
      <SidebarNavigationView
        expanded
        items={listenNavigationItems(translate, false)}
        sections={collectionNavigationItems(translate, false, location)}
        collectionLabel="Collection"
        expandLabel="Expand sidebar"
        collectionActive={
          location.pathname === "/library" ||
          location.pathname.startsWith("/collection") ||
          location.pathname === "/bandcamp"
        }
        onToggleExpanded={() => {}}
      />
    </div>
  );
}
export function CollectionNavigationExamples() {
  return (
    <MemoryRouter initialEntries={["/library?tab=artists"]}>
      <Sample label="Collection navigation · one item geometry across both levels">
        <CollectionNavigationContent />
      </Sample>
    </MemoryRouter>
  );
}

export function RowInteractionExamples() {
  const [selected, setSelected] = useState(true);
  const rows = [
    { title: "Hover track", active: false, selected: false, disabled: false },
    { title: "Selected track", active: false, selected, disabled: false },
    { title: "Current track", active: true, selected: false, disabled: false },
    {
      title: "Unavailable track",
      active: false,
      selected: false,
      disabled: true,
    },
  ];
  return (
    <Sample label="Track interactions · hover, selected and current are separate states">
      <HairlineList label="Hairline selection reference">
        <HairlineRow active>Reference selection surface</HairlineRow>
      </HairlineList>
      <TrackList
        label="Track interaction states"
        items={rows}
        itemKey={(row) => row.title}
        renderRow={(row, index) => (
          <TrackRowView
            {...row}
            aria-label={row.title}
            aria-selected={row.selected}
            onClick={() =>
              row.title === "Selected track" && setSelected(!selected)
            }
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                row.title === "Selected track" &&
                (event.key === " " || event.key === "Enter")
              ) {
                event.preventDefault();
                setSelected(!selected);
              }
            }}
          >
            <TrackRowContent
              title={row.title}
              details={
                <span className="text-xs text-text-muted">
                  Costa Norte · Luz de octubre
                </span>
              }
              duration="3:24"
              leading={
                <TrackRowPlaybackControl
                  index={index + 1}
                  isActive={row.active}
                  isPlaying={false}
                  disabled={row.disabled}
                  label={`Play ${row.title}`}
                  onClick={(event) => event.stopPropagation()}
                  artwork={
                    <MediaCover
                      src={IMAGE_SAMPLES[0]}
                      alt=""
                      className="size-12"
                    />
                  }
                  activeGlyph={
                    <TrackRowPlaybackProgressView
                      currentTime={30}
                      duration={204}
                      isPlaying={false}
                    />
                  }
                />
              }
              actions={
                <ActionButton
                  label={`More actions for ${row.title}`}
                  tooltip="More"
                  disabled={row.disabled}
                >
                  <MoreHorizontal />
                </ActionButton>
              }
            />
          </TrackRowView>
        )}
      />
    </Sample>
  );
}

export function ArtistAvatarExamples() {
  return (
    <Sample label="Artist identity · compact avatars, full-size media thumbnails">
      <div
        className="flex items-center gap-2"
        data-testid="album-artist-identity"
      >
        <EntityAvatar
          name="Costa Norte"
          alt=""
          size="xs"
          src={IMAGE_SAMPLES[0]}
        />
        <span>Costa Norte · album byline</span>
      </div>
      <div
        className="flex items-center gap-2"
        data-testid="player-artist-identity"
      >
        <EntityAvatar
          name="Costa Norte"
          alt=""
          size="inline"
          src={IMAGE_SAMPLES[0]}
        />
        <span>Costa Norte · player identity</span>
      </div>
      <div
        className="flex items-center gap-2"
        data-testid="missing-artist-identity"
      >
        <EntityAvatar name="Costa Norte" alt="" size="inline" />
        <span>Costa Norte · unavailable photo</span>
      </div>
      <div
        className="flex items-center gap-3"
        data-testid="standalone-artist-thumbnail"
      >
        <MediaCover
          src={IMAGE_SAMPLES[0]}
          alt=""
          shape="circle"
          className="size-12"
        />
        <span>Costa Norte · list thumbnail</span>
      </div>
    </Sample>
  );
}

export function ShowGenreExamples() {
  return (
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Sample label="Show genres · real profile retained">
          <UpcomingMonthGroupView label="November 2026">
            <UpcomingShowExpandedView
              artistHref="/artists/sample-artist"
              item={{
                type: "show",
                artist: "Costa Norte",
                date: "2026-11-03",
                time: "19:00",
                title: "Sample venue",
                subtitle: "Sample city",
                venue: "Sample venue",
                city: "Sample city",
                country: "Spain",
                cover_url: null,
                status: "onsale",
                is_upcoming: true,
                genres: ["ambient", "drone", "electronic"],
                genre_profile: [
                  { name: "Ambient", percent: 100, source: "sample" },
                  { name: "Drone", percent: 72, source: "sample" },
                  { name: "Electronic", percent: 0, source: "sample" },
                ],
              }}
              attending={false}
              savingAttendance={false}
              playingSetlist={false}
              onToggleAttendance={() => {}}
              onPlaySetlist={() => {}}
              onClose={() => {}}
              showClose={false}
            />
          </UpcomingMonthGroupView>
          <p className="text-sm text-text-muted">
            The real show view receives the artist's supplied genre profile,
            including source and percentages. Name-only responses keep their
            names without invented percentages.
          </p>
        </Sample>
      </I18nextProvider>
    </MemoryRouter>
  );
}

export function TrackMetadataExamples() {
  const samples = [
    {
      title: "CD source · two-digit tempo",
      format: "flac",
      depth: 16,
      rate: 44100,
      bpm: 76,
      key: "F",
      scale: "major",
      duration: "6:04",
    },
    {
      title: "Hi-res source · three-digit tempo",
      format: "flac",
      depth: 24,
      rate: 176400,
      bpm: 136,
      key: "F#",
      scale: "minor",
      duration: "1:06:56",
    },
    {
      title: "Format only · no inferred quality",
      format: "flac",
      bpm: 81,
      duration: "4:30",
    },
    {
      title: "Key only · no tempo",
      key: "C",
      scale: "minor",
      duration: "3:00",
    },
    { title: "No metadata · slots retained" },
  ];
  return (
    <Sample label="Track metadata · fixed columns, partial and unavailable data">
      <TrackList
        role="list"
        aria-label="Track metadata alignment"
        items={samples}
        itemKey={(track) => track.title}
        renderRow={(track, index) => (
          <TrackRowView role="listitem" aria-label={track.title}>
            <TrackRowContent
              title={track.title}
              meta="Costa Norte · Luz de octubre"
              quality={getQualityBadge({
                format: track.format,
                bitDepth: track.depth,
                sampleRate: track.rate,
              })}
              tempo={formatTrackAnalysis(track.bpm)}
              musicalKey={formatMusicalKey(track.key, track.scale)}
              duration={track.duration}
              leading={
                <TrackRowPlaybackControl
                  disabled={false}
                  index={index + 1}
                  isActive={false}
                  isPlaying={false}
                  label={`Play ${track.title}`}
                  artwork={
                    <MediaCover
                      src={IMAGE_SAMPLES[0]}
                      alt=""
                      className="size-12"
                    />
                  }
                  onClick={() => {}}
                />
              }
              like={
                index === 4 ? null : (
                  <ActionButton
                    label={`Like ${track.title}`}
                    tooltip="Like"
                    onClick={() => {}}
                  >
                    <Heart />
                  </ActionButton>
                )
              }
              actions={
                <ActionButton
                  label={`More actions for ${track.title}`}
                  tooltip="More"
                  onClick={() => {}}
                >
                  <MoreHorizontal />
                </ActionButton>
              }
            />
          </TrackRowView>
        )}
      />
      <p className="text-sm text-text-muted">
        Each value belongs to the track. Missing source details stay unknown.
        Quality appears from 480 px of row space; analysis from 620 px. Narrow
        queues and mobile retain duration and actions.
      </p>
    </Sample>
  );
}
