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
  StatsPanel,
  StatsActionBandView,
  StatsEditorialStack,
  StatsListeningView,
} from "../../../app/listen/src/pages/StatsPageView";
import { StatsFreshness } from "../../../app/listen/src/components/stats/StatsFreshness";
import { StatsHeadlineNumbers } from "../../../app/listen/src/components/stats/StatsHeadlineNumbers";
import { StatsExplorerReview } from "./StatsExplorerReview";
import { StatsArtistOfPeriodView } from "../../../app/listen/src/components/stats/StatsArtistOfPeriodView";
import { StatsHighlightsView } from "../../../app/listen/src/components/stats/StatsHighlightsView";
import { StatsSoundProfileView } from "../../../app/listen/src/pages/StatsSoundProfileView";
import { StatsHeatmapCard } from "../../../app/listen/src/components/stats/StatsHeatmapCard";
import { StatsGenreTrendView } from "../../../app/listen/src/components/stats/StatsGenreTrendView";
import {
  StatsDecadeColumnsView,
  StatsDiscoveriesCardView,
  StatsMusicAgeCardView,
} from "../../../app/listen/src/components/stats/StatsClosingViews";
import { StatsArtistRankView } from "../../../app/listen/src/pages/StatsArtistRankView";
import { StatsPeriodPicker } from "../../../app/listen/src/components/stats/StatsPeriodPicker";
import { StatsPlayMeta } from "../../../app/listen/src/components/stats/StatsPlayMeta";
import {
  statsDashboardReadState,
  statsSelectionOptions,
} from "../../../app/listen/src/pages/stats-page-model";
import type { StatsSelection } from "../../../app/listen/src/components/stats/stats-types";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
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
dashboard.top_albums.items = [
  {
    album: "Nights of Lust",
    artist: "The Lovecraft Sextet",
    play_count: 70,
    complete_play_count: 65,
    minutes_listened: 310,
  },
];
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
          showDigging={scope === "personal"}
          actions={
            <>
              {scope === "personal" ? (
                <Button onClick={() => setDigging(true)}>
                  {t("stats.digging.open")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => setAction("Replay prepared")}
              >
                {t("stats.signal.playReplay")}
              </Button>
            </>
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
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <StatsPanel
            title={t("stats.topTracks.title")}
            subtitle={t("stats.topTracks.subtitle")}
          >
            <div role="table" aria-label="Ranked tracks">
              <TrackRowView>
                <TrackRowContent
                  rank={1}
                  leading={
                    <MediaCover
                      src={IMAGE_SAMPLES[0]}
                      alt=""
                      className="size-12"
                    />
                  }
                  title="Darkness"
                  details={<MonoLabel>The Lovecraft Sextet</MonoLabel>}
                  meta={<StatsPlayMeta playCount={22} minutes={132} isNew />}
                  actions={null}
                />
              </TrackRowView>
            </div>
          </StatsPanel>
          <StatsPanel
            title={t("stats.topArtists.title")}
            subtitle={t("stats.topArtists.subtitle")}
          >
            <StatsArtistRankView
              item={{
                artist_id: 8,
                artist_name: "Converge",
                play_count: 204,
                complete_play_count: 200,
                minutes_listened: 720,
                is_new: true,
              }}
              index={1}
              share={0.18}
              href="/fixture/artist"
              artwork={photo(
                "absolute inset-0 size-full object-cover grayscale opacity-55",
              )}
            />
          </StatsPanel>
        </div>
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
        <StatsListeningView>
          {!legacy ? <StatsHeatmapCard heatmap={dashboard.heatmap!} /> : null}
          <StatsSoundProfileView
            profile={{
              energy: long ? 0 : legacy ? null : 0.79,
              danceability: legacy ? null : 0.32,
              valence: legacy ? null : 0.5,
              bpm: legacy ? null : 137,
            }}
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
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <StatsMusicAgeCardView
              musicAge={dashboard.music_age!}
              decades={
                <StatsDecadeColumnsView
                  musicAge={dashboard.music_age!}
                  linked
                  getAlbumHref={() => "/fixture/album"}
                  renderAlbum={() => photo("stats-decade-cover")}
                />
              }
            />
            <StatsDiscoveriesCardView
              discoveries={dashboard.story!.discoveries}
              renderArtist={() => (
                <MediaCover
                  src={IMAGE_SAMPLES[2]}
                  alt=""
                  shape="circle"
                  className="size-12 shrink-0"
                />
              )}
              getArtistHref={() => "/fixture/artist"}
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
