import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@crate/ui/shadcn/button";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import {
  baseDashboard,
  signalDashboard,
} from "../../../app/listen/src/test/stats-dashboard-fixture";
import {
  StatsHeaderView,
  StatsPageView,
  StatsRankings,
  StatsPanel,
  StatsActionBandView,
  StatsEditorialStack,
  StatsListeningView,
} from "../../../app/listen/src/pages/StatsPageView";
import { StatsFreshness } from "../../../app/listen/src/components/stats/StatsFreshness";
import { StatsHeadlineNumbers } from "../../../app/listen/src/components/stats/StatsHeadlineNumbers";
import { StatsExplorerReview } from "./StatsExplorerReview";
import { StatsArtistOfPeriodView } from "../../../app/listen/src/components/stats/StatsArtistOfPeriodView";
import { StatsReplayCard } from "../../../app/listen/src/components/stats/StatsReplayCard";
import { StatsHighlightsView } from "../../../app/listen/src/components/stats/StatsHighlightsView";
import { StatsSoundProfileView } from "../../../app/listen/src/pages/StatsSoundProfileView";
import { ListeningHeatmap } from "../../../app/listen/src/components/stats/ListeningHeatmap";
import { heatmapTopGenre } from "../../../app/listen/src/components/stats/heatmap-model";
import { StatsGenreTrendView } from "../../../app/listen/src/components/stats/StatsGenreTrendView";
import {
  StatsDecadeColumnsView,
  StatsMusicAgeCardView,
} from "../../../app/listen/src/components/stats/StatsClosingViews";
import { musicAgeShareYear } from "../../../app/listen/src/components/stats/stats-tape-model";
import {
  StatsMovementView,
  statsMovementNewArtists,
} from "../../../app/listen/src/components/stats/StatsMovementView";
import { StatsArtistRankView } from "../../../app/listen/src/pages/StatsArtistRankView";
import { StatsPeriodPicker } from "../../../app/listen/src/components/stats/StatsPeriodPicker";
import { StatsPlayMeta } from "../../../app/listen/src/components/stats/StatsPlayMeta";
import {
  statsDashboardReadState,
  statsSelectionOptions,
} from "../../../app/listen/src/pages/stats-page-model";
import type {
  ReplayMix,
  StatsSelection,
} from "../../../app/listen/src/components/stats/stats-types";
import { StatsRangeTrackView } from "../../../app/listen/src/components/stats/explorer/StatsRangeTrackView";
import { DiggingStory } from "../../../app/listen/src/components/stats/digging/DiggingStory";
import {
  buildDiggingChapters,
  type DiggingMedia,
} from "../../../app/listen/src/components/stats/digging/build-digging-chapters";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
const dashboard = signalDashboard();
dashboard.top_tracks.items = [
  {
    track_id: 1,
    track_path: "/fixture/track.flac",
    title: "Darkness",
    artist: "The Lovecraft Sextet",
    album: "Nights of Lust",
    play_count: 22,
    complete_play_count: 20,
    minutes_listened: 132,
  },
];
dashboard.story!.movers = [
  {
    artist_name: "Gorguts",
    play_count: 36,
    minutes_listened: 140,
    previous_play_count: 12,
    delta_play_count: 24,
  },
  {
    artist_name: "Ulcerate",
    play_count: 21,
    minutes_listened: 98,
    previous_play_count: 9,
    delta_play_count: 12,
  },
];
dashboard.story!.comebacks = [
  {
    artist_name: "Deathspell Omega",
    play_count: 17,
    minutes_listened: 80,
    last_seen_at: "2026-02-11T20:00:00+00:00",
  },
];
dashboard.top_albums.items = [
  {
    album: "Nights of Lust",
    artist: "The Lovecraft Sextet",
    play_count: 70,
    complete_play_count: 65,
    minutes_listened: 310,
  },
];
const replayFixture: ReplayMix = {
  window: "30d",
  title: "Replay",
  subtitle: "Snapshot",
  title_key: "stats.replay.thisMonth.title",
  track_count: 25,
  minutes_listened: 95,
  items: [1, 2, 3, 4].map((id) => ({
    track_id: id,
    track_path: null,
    title: `Fixture track ${id}`,
    artist: "Fixture artist",
    album: `Fixture album ${id}`,
    play_count: 5,
    complete_play_count: 5,
    minutes_listened: 15,
  })),
};
const photo = (className: string) => (
  <img src={IMAGE_SAMPLES[1]} alt="" className={className} />
);
const renderDecades: DiggingMedia["renderDecades"] = (age) => (
  <StatsDecadeColumnsView
    musicAge={age}
    getAlbumHref={() => "/fixture/album"}
    renderAlbum={() => photo("stats-decade-cover")}
    className="stats-digging-decades"
  />
);
// Heatmap fixtures: Crate Pulse below three listeners arrives blanked by the
// instance builder (PD43) and hides its grid; "long and zero" shows the flat
// zero-minute grid.
const globalHeatmap = {
  cells: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
  peak: null,
  night_share: null,
  night_hours: [22, 23, 0, 1, 2, 3, 4, 5],
  listener_count: 2,
  hidden_reason: "few_listeners",
};
const zeroHeatmap = {
  cells: Array.from({ length: 7 }, () => Array<number>(24).fill(0)),
  peak: null,
  night_share: 0,
  night_hours: [22, 23, 0, 1, 2, 3, 4, 5],
};
const media: DiggingMedia = {
  albumCover: () => IMAGE_SAMPLES[0]!,
  renderImage: (src) => <img src={src} alt="" />,
  renderArtist: () => photo("stats-digging-artist-photo"),
  renderDecades,
};
const states = [
  "ready",
  "pending",
  "loading",
  "error",
  "empty",
  "cached",
  "legacy",
  "long and zero",
] as const;
export function StatsOverviewReview({
  initialState = "ready",
  initialScope = "personal",
  initialDigging = false,
}: {
  initialState?: (typeof states)[number];
  initialScope?: "personal" | "global" | "user";
  initialDigging?: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<string>(initialState),
    [scope, setScope] = useState<"personal" | "global" | "user">(initialScope);
  const [period, setPeriod] = useState<StatsSelection>("30d"),
    [digging, setDigging] = useState(initialDigging),
    [action, setAction] = useState("No fixture action yet");
  const legacy = state === "legacy",
    long = state === "long and zero";
  const artist = {
    ...dashboard.artist_of_period!,
    artist_name: long
      ? "A very long artist name with an uninterruptedidentitythatmustwrapwithinitsframe"
      : "Converge",
    first_ever_day: "2026-09-12",
  };
  const chapters = buildDiggingChapters(
    dashboard,
    t,
    "Last 30 days in Crate",
    "crate.fixture",
    media,
    (summary) => setAction(`Share prepared: ${summary.headline}`),
  );
  return (
    <section
      className="grid min-w-0 gap-6"
      aria-label="Stats presentation review"
    >
      <div className="flex flex-wrap gap-4">
        <FormField label="Dashboard state">
          {(control) => (
            <Select value={state} onValueChange={setState}>
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {states.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label="Stats scope">
          {(control) => (
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as typeof scope)}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["personal", "global", "user"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      <StatsPageView
        header={
          <StatsHeaderView
            title={
              scope === "global"
                ? "Crate Pulse"
                : scope === "user"
                  ? "Listener signal"
                  : "30 days of signal"
            }
            kicker="Listener signal"
            scope={scope}
            profileHref="/fixture/profile"
            freshness={
              <StatsFreshness
                snapshot={{
                  built_at: new Date(Date.now() - 4 * 60_000).toISOString(),
                }}
                provisional
              />
            }
            period={
              <StatsPeriodPicker
                value={period}
                options={statsSelectionOptions(2026, {
                  calendarYear: scope === "personal",
                })}
                onChange={setPeriod}
              />
            }
          />
        }
        readState={statsDashboardReadState(
          state === "pending"
            ? { ...baseDashboard(), snapshot: { pending: true, version: 0 } }
            : state === "loading" || state === "error"
              ? null
              : dashboard,
          state === "loading",
          state === "error" ? "Fixture failure" : null,
        )}
        empty={state === "empty"}
        onRetry={() => setState("ready")}
      >
        <StatsHeadlineNumbers
          minutes={long ? 0 : dashboard.overview.minutes_listened}
          plays={dashboard.overview.play_count}
          activeDays={27}
          artists={legacy ? null : 64}
          comparison={
            period === "all_time"
              ? null
              : {
                  previous: {
                    start: "2026-08-22",
                    end: "2026-09-20",
                    minutes_listened: long ? 0 : 3050,
                    play_count: 840,
                    active_days: 0,
                    artist_count: 64,
                  },
                  caption: "vs previous 30 days",
                }
          }
          today={{
            day: "2026-10-20",
            timezone: "Europe/Madrid",
            minutes: 38,
            plays: 9,
          }}
        />
        {!legacy ? (
          <StatsExplorerReview
            key={period}
            tape={dashboard.tape!}
            selection={period}
          />
        ) : null}
        <StatsActionBandView
          diggingAction={
            scope === "personal" ? (
              <Button onClick={() => setDigging(true)}>
                {t("stats.digging.open")}
              </Button>
            ) : undefined
          }
          replay={
            <StatsReplayCard
              replay={replayFixture}
              onPlay={() => setAction("Replay played")}
              onShuffle={() => setAction("Replay shuffled")}
              coverUrl={(item) => IMAGE_SAMPLES[(item.track_id ?? 0) % 2]!}
            />
          }
        />
        {!legacy ? (
          <StatsEditorialStack
            artist={
              <StatsArtistOfPeriodView
                artist={artist}
                periodStart={dashboard.tape?.start}
                href="/fixture/artist"
                artwork={photo("size-full object-cover")}
              />
            }
            highlights={
              <StatsHighlightsView
                highlights={dashboard.highlights!}
                newArtistsHref={
                  statsMovementNewArtists(
                    dashboard.story!,
                    [artist.artist_name],
                    scope,
                  ).length
                    ? "#movement"
                    : undefined
                }
                onPlayObsession={() => setAction("Obsession played")}
                obsessionArtwork={
                  <MediaCover
                    src={IMAGE_SAMPLES[0]}
                    alt=""
                    className="size-20 shrink-0"
                  />
                }
              />
            }
          />
        ) : null}
        {!legacy ? (
          <StatsMovementView
            story={dashboard.story!}
            exclude={[artist.artist_name]}
            scope={scope}
            getArtistHref={() => "/fixture/artist"}
            renderArtist={() => (
              <MediaCover
                src={IMAGE_SAMPLES[2]}
                alt=""
                shape="circle"
                className="size-12 shrink-0"
              />
            )}
          />
        ) : null}
        <StatsRankings>
          <StatsPanel
            title={t("stats.topTracks.title")}
            subtitle={t("stats.topTracks.subtitle")}
          >
            <div role="group" aria-label="Ranked tracks">
              <StatsRangeTrackView
                track={{
                  track_id: 1,
                  title: "Darkness",
                  artist: "The Lovecraft Sextet",
                  album: "Nights of Lust",
                  plays: 22,
                  minutes: 132,
                  format: "flac",
                  sample_rate: 44100,
                  bit_depth: 16,
                  duration: 364,
                  bpm: 76,
                  audio_key: "D",
                  audio_scale: "minor",
                }}
                cover={IMAGE_SAMPLES[0]!}
                withAlbum
                onPlay={() => setAction("Darkness played")}
              />
            </div>
          </StatsPanel>
          <StatsPanel
            title={t("stats.topArtists.title")}
            subtitle={t("stats.topArtists.subtitle")}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {["Converge", "Low"].map((name, index) => (
                <StatsArtistRankView
                  key={name}
                  item={{
                    artist_id: 8 + index,
                    artist_name: name,
                    play_count: index ? 91 : 204,
                    complete_play_count: index ? 90 : 200,
                    minutes_listened: index ? 310 : 720,
                    is_new: true,
                  }}
                  index={index}
                  share={index ? 0.18 : 0.42}
                  href="/fixture/artist"
                  artwork={photo(
                    "absolute inset-0 size-full object-cover grayscale opacity-55",
                  )}
                />
              ))}
            </div>
          </StatsPanel>
        </StatsRankings>
        <StatsPanel
          title={t("stats.topAlbums.title")}
          subtitle={t("stats.topAlbums.subtitle")}
        >
          <MediaGrid>
            {IMAGE_SAMPLES.map((src, index) => (
              <EntityCard
                key={src}
                title={`Album ${index + 1}`}
                subtitle="Converge"
                artwork={<MediaCover src={src} alt="" />}
                meta={<StatsPlayMeta playCount={70} minutes={310} isNew />}
                href="/fixture/album"
              />
            ))}
          </MediaGrid>
        </StatsPanel>
        <StatsListeningView
          band={
            legacy ? null : (
              <ListeningHeatmap
                key={scope}
                heatmap={
                  long
                    ? zeroHeatmap
                    : scope === "global"
                      ? globalHeatmap
                      : dashboard.heatmap
                }
                timezone={dashboard.timezone}
                showNow={scope === "personal"}
                scope={scope}
                topGenre={heatmapTopGenre(
                  dashboard.top_genres.items,
                  dashboard.genre_trend,
                )}
              />
            )
          }
        >
          <StatsSoundProfileView
            profile={{
              energy: long ? 0 : legacy ? null : 0.79,
              danceability: legacy ? null : 0.32,
              valence: legacy ? null : 0.5,
              bpm: legacy ? null : 137,
            }}
            previousProfile={
              legacy
                ? null
                : { energy: 0.64, danceability: 0.4, valence: null, bpm: 131 }
            }
            favourite={
              legacy ? null : { title: "Concubine", artist: "Converge" }
            }
            skipRate={0.05}
            genres={[]}
            hideGenres
          />
          {!legacy ? (
            <StatsGenreTrendView
              genres={dashboard.genre_trend!}
              onGenreSelect={(slug) => setAction(`Genre selected: ${slug}`)}
            />
          ) : null}
        </StatsListeningView>
        {!legacy ? (
          <div className="grid min-w-0 gap-5">
            <StatsMusicAgeCardView
              musicAge={dashboard.music_age!}
              shareYear={musicAgeShareYear(dashboard.tape, 2026)}
              decades={
                <StatsDecadeColumnsView
                  musicAge={dashboard.music_age!}
                  linked
                  getAlbumHref={() => "/fixture/album"}
                  renderAlbum={() => photo("stats-decade-cover")}
                />
              }
            />
          </div>
        ) : null}
      </StatsPageView>
      <output aria-label="Stats fixture action" aria-live="polite">
        {action}
      </output>
      {digging ? (
        <DiggingStory chapters={chapters} onClose={() => setDigging(false)} />
      ) : null}
    </section>
  );
}
