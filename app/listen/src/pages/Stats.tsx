import { useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Disc3,
  Flame,
  Music2,
  Play,
  Repeat2,
  Search,
  Users,
} from "@crate/ui/icons";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { WindowPicker } from "@/components/stats/StatsPanels";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  buildRecapHighlights,
  formatStatsMinutes,
  formatStatsPercent,
  toPlayerTrack,
  type ReplayMix,
  type StatsAlbum,
  type StatsAffinity,
  type StatsArtist,
  type StatsDashboard,
  type StatsGenre,
  type StatsStory,
  type StatsStoryArtistSignal,
  type StatsTrack,
  type StatsTrendPoint,
  type StatsWindow,
} from "@/components/stats/stats-model";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPhotoApiUrl,
  artistPagePath,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";

const WINDOW_COPY_KEYS: Record<StatsWindow, { title: string; label: string }> =
  {
    "7d": { title: "stats.window.7d", label: "stats.window.week" },
    "30d": { title: "stats.window.30d", label: "stats.window.month" },
    "90d": { title: "stats.window.90d", label: "stats.window.season" },
    "365d": { title: "stats.window.365d", label: "stats.window.year" },
    all_time: { title: "stats.window.allTime", label: "stats.window.archive" },
  };

const STATS_WINDOWS: StatsWindow[] = ["7d", "30d", "90d", "365d", "all_time"];
const NARRATIVE_TONES = [
  "stats-narrative-tone-cool",
  "stats-narrative-tone-warm",
  "stats-narrative-tone-alert",
];

function normalizeWindowParam(value: string | null): StatsWindow {
  return STATS_WINDOWS.includes(value as StatsWindow)
    ? (value as StatsWindow)
    : "30d";
}

function normalizeMonthParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function formatMonthTitle(month: string, locale: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

export function Stats() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { username } = useParams<{ username: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobalStats = location.pathname === "/stats/global";
  const isUserStats = Boolean(username);
  const selectedMonth = normalizeMonthParam(searchParams.get("month"));
  const selectedWindow = selectedMonth
    ? "30d"
    : normalizeWindowParam(searchParams.get("window"));
  const statsPeriodQuery = selectedMonth
    ? `month=${selectedMonth}`
    : `window=${selectedWindow}`;
  const windowCopy = useMemo(
    () =>
      Object.fromEntries(
        STATS_WINDOWS.map((window) => {
          const copy = WINDOW_COPY_KEYS[window];
          return [
            window,
            { title: t(copy.title), label: t(copy.label) },
          ] as const;
        }),
      ) as Record<StatsWindow, { title: string; label: string }>,
    [t],
  );
  const period = selectedMonth
    ? {
        title: formatMonthTitle(selectedMonth, i18n.language),
        label: t("stats.window.month"),
      }
    : windowCopy[selectedWindow];

  const { play, playAll } = usePlayerActions();
  const statsEndpoint = isGlobalStats
    ? "/api/stats/dashboard"
    : username
      ? `/api/users/${encodeURIComponent(username)}/stats/dashboard`
      : "/api/me/stats/dashboard";
  const { data: dashboard, loading: dashboardLoading } = useApi<StatsDashboard>(
    `${statsEndpoint}?${statsPeriodQuery}&tracks_limit=12&artists_limit=10&albums_limit=12&genres_limit=10&replay_limit=36`,
  );

  const overview = dashboard?.overview;
  const trends = dashboard?.trends;
  const topTrackItems = dashboard?.top_tracks.items ?? [];
  const topArtistItems = dashboard?.top_artists.items ?? [];
  const topAlbumItems = dashboard?.top_albums.items ?? [];
  const topGenreItems = dashboard?.top_genres.items ?? [];
  const replay = dashboard?.replay as ReplayMix | undefined;
  const story = dashboard?.story;
  const replayItems = replay?.items ?? [];
  const changeWindow = (window: StatsWindow) => {
    setSearchParams({ window });
  };

  const recapHighlights = useMemo(
    () =>
      buildRecapHighlights(
        overview ?? undefined,
        replay ?? undefined,
        topArtistItems,
        topTrackItems,
        t,
      ),
    [overview, replay, topArtistItems, topTrackItems, t],
  );

  const soundProfile = useMemo(
    () =>
      story?.audio_profile
        ? {
            energy: story.audio_profile.energy,
            danceability: story.audio_profile.danceability,
            valence: story.audio_profile.valence,
            bpm: story.audio_profile.bpm ?? null,
          }
        : buildSoundProfile(topTrackItems),
    [story?.audio_profile, topTrackItems],
  );

  const coverTracks = replayItems.length ? replayItems : topTrackItems;
  const leadTrack = topTrackItems[0];
  const leadArtist = topArtistItems[0];
  const leadGenre = topGenreItems[0];
  const topMover = story?.movers[0];
  const topDiscovery = story?.discoveries[0];
  const topComeback = story?.comebacks[0];
  const hasStats = Boolean(overview?.play_count);
  const subjectName =
    dashboard?.subject?.display_name ||
    dashboard?.subject?.username ||
    username ||
    null;
  const heroTitle = isGlobalStats
    ? t("stats.hero.globalTitle")
    : isUserStats && subjectName
      ? t("stats.hero.userTitle", { name: subjectName })
      : t("stats.hero.yourTitle");
  const heroBody = isGlobalStats
    ? t("stats.hero.globalBody")
    : isUserStats
      ? t("stats.hero.userBody")
      : t("stats.hero.yourBody");

  const playTopTrack = (item: StatsTrack) => {
    const track = toPlayerTrack(item);
    play(track, {
      type: "track",
      name: item.title,
      id: item.track_id ?? item.track_path,
    });
  };

  const playReplay = () => {
    if (!replayItems.length) return;
    playAll(replayItems.map(toPlayerTrack), 0, {
      type: "playlist",
      name: replay?.title || t("stats.replay.title"),
    });
  };

  return (
    <div className="relative -mx-4 -mt-2 overflow-hidden px-4 pb-12 pt-3 sm:-mx-6 sm:px-6">
      <div className="stats-page-atmosphere pointer-events-none absolute inset-0 -z-10" />
      <div className="stats-page-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-30" />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="stats-hero-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]">
            <BarChart3 size={12} />
            {t("stats.hero.badge")}
          </div>
          <h1 className="stats-hero-title mt-4 max-w-4xl text-[clamp(2.65rem,8vw,7.5rem)] font-black uppercase leading-[0.82] tracking-[-0.085em]">
            {heroTitle}
            <span className="stats-hero-title-accent block">
              {t("stats.hero.decoded")}
            </span>
          </h1>
          <p className="stats-hero-body mt-4 max-w-2xl text-sm leading-6 sm:text-base">
            {heroBody}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {!isUserStats ? (
              <>
                <ScopeLink active={!isGlobalStats} to="/stats">
                  {t("stats.scope.yourDna")}
                </ScopeLink>
                <ScopeLink active={isGlobalStats} to="/stats/global">
                  {t("stats.scope.cratePulse")}
                </ScopeLink>
              </>
            ) : username ? (
              <ScopeLink active={false} to={`/users/${username}`}>
                {t("stats.scope.backToProfile")}
              </ScopeLink>
            ) : null}
          </div>
          <WindowPicker
            value={selectedMonth ? null : selectedWindow}
            onChange={changeWindow}
          />
        </div>
      </div>

      <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="stats-hero-surface relative min-h-[520px] overflow-hidden rounded-[12px] p-5 sm:p-7">
          <StatsCoverMosaic tracks={coverTracks} />
          <div className="stats-hero-overlay absolute inset-0" />
          <div className="relative z-10 flex min-h-[460px] flex-col justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="stats-hero-period-muted rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
                {period.label}
              </span>
              <span className="stats-hero-period-accent rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
                {period.title}
              </span>
            </div>

            <div>
              <div className="stats-hero-title max-w-3xl text-[clamp(3.8rem,13vw,10rem)] font-black uppercase leading-[0.75] tracking-[-0.1em]">
                {leadGenre?.genre_name || leadArtist?.artist_name || "Crate"}
              </div>
              <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
                <HeroMetric
                  label={t("stats.metrics.minutes")}
                  value={formatStatsMinutes(overview?.minutes_listened ?? 0)}
                />
                <HeroMetric
                  label={t("stats.metrics.plays")}
                  value={
                    overview?.play_count ? String(overview.play_count) : "0"
                  }
                />
                <HeroMetric
                  label={t("stats.metrics.activeDays")}
                  value={
                    overview?.active_days ? String(overview.active_days) : "0"
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-4">
          <ReplayCard
            replay={replay}
            items={replayItems}
            loading={dashboardLoading}
            onPlay={playReplay}
            onPlayTrack={playTopTrack}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SignalCard
              icon={Flame}
              label={t("stats.signals.obsession")}
              title={leadTrack?.title || t("stats.signals.noDominantTrack")}
              body={
                leadTrack
                  ? t("stats.signals.dominantTrackBody", {
                      artist: leadTrack.artist,
                      count: leadTrack.play_count,
                    })
                  : t("stats.signals.noDominantTrackBody")
              }
            />
            <SignalCard
              icon={Search}
              label={
                topDiscovery
                  ? t("stats.signals.discovery")
                  : t("stats.signals.gravity")
              }
              title={
                topDiscovery?.artist_name ||
                leadArtist?.artist_name ||
                t("stats.signals.noLeadingArtist")
              }
              body={
                topDiscovery
                  ? t("stats.signals.discoveryBody", {
                      count: topDiscovery.play_count,
                    })
                  : leadArtist
                    ? t("stats.signals.gravityBody", {
                        minutes: formatStatsMinutes(
                          leadArtist.minutes_listened,
                        ),
                        count: leadArtist.play_count,
                      })
                    : t("stats.signals.noLeadingArtistBody")
              }
            />
          </div>
        </aside>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        {recapHighlights.length > 0 ? (
          recapHighlights.map((item, index) => (
            <NarrativeTile key={item.title} index={index} {...item} />
          ))
        ) : (
          <div className="stats-card-empty rounded-[12px] border-dashed p-6 text-sm lg:col-span-3">
            {t("stats.empty.recap")}
          </div>
        )}
      </section>

      <StatsStorySection
        story={story}
        fallbackMover={topMover}
        fallbackDiscovery={topDiscovery}
        fallbackComeback={topComeback}
      />

      <AffinityCard
        affinity={dashboard?.viewer_affinity}
        subject={subjectName}
      />

      <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <SoundProfileCard
          profile={soundProfile}
          genres={topGenreItems}
          skipRate={overview?.skip_rate ?? 0}
        />
        <ListeningPulseCard
          story={story}
          points={trends?.points ?? []}
          loading={dashboardLoading}
        />
      </section>

      <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <TopTracksPanel
          items={topTrackItems}
          loading={dashboardLoading}
          onPlayTrack={playTopTrack}
        />
        <TopArtistsPanel items={topArtistItems} loading={dashboardLoading} />
      </section>

      <TopAlbumsPanel items={topAlbumItems} loading={dashboardLoading} />

      {!dashboardLoading && !hasStats ? (
        <div className="stats-card-empty mt-8 rounded-[12px] border-dashed p-8 text-center">
          <h2 className="text-xl font-black text-text-primary">
            {t("stats.empty.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-text-muted">
            {t("stats.empty.body")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ScopeLink({
  active,
  to,
  children,
}: {
  active: boolean;
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] transition-colors",
        active
          ? "border-accent-action/30 bg-accent-action/15 text-accent-action"
          : "stats-scope-link-inactive",
      )}
    >
      {children}
    </Link>
  );
}

function AffinityCard({
  affinity,
  subject,
}: {
  affinity?: StatsAffinity | null;
  subject?: string | null;
}) {
  const { t } = useTranslation();
  if (!affinity) return null;

  const reasons = affinity.affinity_reasons ?? [];
  const bandKey = `stats.affinity.band.${affinity.affinity_band}`;
  const bandFallback = affinity.affinity_band.replace("_", " ");
  return (
    <section className="stats-affinity-card mt-8 overflow-hidden rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent-action/25 bg-accent-action/15 text-accent-action">
            <Users size={20} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-action">
              {t("stats.affinity.title")}
            </div>
            <h2 className="mt-2 text-3xl font-black uppercase leading-none tracking-[-0.06em] text-text-primary">
              {t("stats.affinity.score", {
                score: affinity.affinity_score,
              })}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              {subject
                ? t("stats.affinity.subjectBody", { subject })
                : t("stats.affinity.listenerBody")}
            </p>
          </div>
        </div>
        <div className="stats-muted-pill rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em]">
          {t(bandKey, { defaultValue: bandFallback })}
        </div>
      </div>
      {reasons.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <span
              key={reason}
              className="stats-muted-chip rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {reason}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StatsStorySection({
  story,
  fallbackMover,
  fallbackDiscovery,
  fallbackComeback,
}: {
  story?: StatsStory;
  fallbackMover?: StatsStoryArtistSignal;
  fallbackDiscovery?: StatsStoryArtistSignal;
  fallbackComeback?: StatsStoryArtistSignal;
}) {
  const { t, i18n } = useTranslation();
  if (!story) return null;
  const mover = fallbackMover ?? story.movers[0];
  const discovery = fallbackDiscovery ?? story.discoveries[0];
  const comeback = fallbackComeback ?? story.comebacks[0];
  const rhythm = story.rhythm;

  if (!mover && !discovery && !comeback && !rhythm.peak_hour_label) return null;

  return (
    <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StorySignalCard
        label={t("stats.story.rising")}
        title={mover?.artist_name || t("stats.story.noSurge")}
        body={
          mover?.delta_play_count
            ? t("stats.story.risingBody", {
                count: mover.delta_play_count,
              })
            : t("stats.story.risingFallback")
        }
      />
      <StorySignalCard
        label={t("stats.story.newBlood")}
        title={discovery?.artist_name || t("stats.story.noNewObsession")}
        body={
          discovery
            ? t("stats.story.discoveryBody", {
                count: discovery.play_count,
              })
            : t("stats.story.discoveryFallback")
        }
      />
      <StorySignalCard
        label={t("stats.story.comeback")}
        title={comeback?.artist_name || t("stats.story.noComeback")}
        body={
          comeback
            ? t("stats.story.comebackBody", {
                count: comeback.play_count,
              })
            : t("stats.story.comebackFallback")
        }
      />
      <StorySignalCard
        label={t("stats.story.peakRitual")}
        title={
          rhythm.peak_hour_label ||
          rhythm.peak_weekday ||
          t("stats.story.noRhythm")
        }
        body={
          rhythm.peak_weekday
            ? t("stats.story.rhythmBody", {
                weekday: formatWeekdayLabel(rhythm.peak_weekday, i18n.language),
                hour: rhythm.peak_hour_label ?? t("stats.story.peakHour"),
              })
            : t("stats.story.rhythmFallback")
        }
      />
    </section>
  );
}

function StorySignalCard({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="stats-card relative overflow-hidden rounded-[12px] p-5">
      <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-accent-action/10 blur-3xl" />
      <div className="relative">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-action">
          {label}
        </div>
        <div className="mt-3 line-clamp-2 text-2xl font-black uppercase leading-[0.9] tracking-[-0.07em] text-text-primary">
          {title}
        </div>
        <p className="mt-3 text-sm leading-6 text-text-muted">{body}</p>
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-hero-metric rounded-lg px-4 py-3 backdrop-blur">
      <div className="stats-hero-metric-label text-[10px] font-black uppercase tracking-[0.2em]">
        {label}
      </div>
      <div className="stats-hero-metric-value mt-1 text-2xl font-black tracking-[-0.04em]">
        {value}
      </div>
    </div>
  );
}

function StatsCoverMosaic({ tracks }: { tracks: StatsTrack[] }) {
  const covers = tracks
    .map((track) =>
      albumCoverApiUrl(
        {
          albumId: track.album_id,
          globalAlbumUid: track.global_album_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        },
        { size: 512 },
      ),
    )
    .filter(Boolean)
    .slice(0, 8);

  return (
    <div className="absolute inset-0 grid grid-cols-2 opacity-80 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => {
        const cover = covers[index % Math.max(covers.length, 1)];
        return (
          <div
            key={index}
            className={cn(
              "stats-mosaic-cell relative min-h-40 overflow-hidden",
              index % 3 === 0 && "scale-105",
            )}
          >
            {cover ? (
              <CrateImage
                src={cover}
                alt=""
                className="h-full w-full object-cover grayscale-[35%] saturate-[0.85]"
                loading={index < 4 ? "eager" : "lazy"}
              />
            ) : (
              <div className="stats-mosaic-placeholder h-full w-full" />
            )}
            <div className="stats-mosaic-overlay absolute inset-0" />
          </div>
        );
      })}
    </div>
  );
}

function ReplayCard({
  replay,
  items,
  loading,
  onPlay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  items: StatsTrack[];
  loading: boolean;
  onPlay: () => void;
  onPlayTrack: (item: StatsTrack) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="stats-replay-card rounded-[12px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="stats-replay-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]">
            <Repeat2 size={12} />
            {t("stats.replay.title")}
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-[-0.06em] text-text-primary">
            {replay?.title || t("stats.replay.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {replay?.subtitle || t("stats.replay.defaultSubtitle")}
          </p>
        </div>
        <button
          onClick={onPlay}
          disabled={!items.length}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-xl shadow-primary/20 transition hover:scale-105 disabled:opacity-50"
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("common.tracks")}
          value={String(replay?.track_count ?? 0)}
        />
        <MiniStat
          label={t("stats.metrics.minutes")}
          value={formatStatsMinutes(replay?.minutes_listened ?? 0)}
        />
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
            {t("stats.replay.loading")}
          </div>
        ) : items.length ? (
          items.slice(0, 5).map((item, index) => (
            <button
              key={`${item.track_id ?? item.track_path ?? item.title}-${index}`}
              onClick={() => onPlayTrack(item)}
              className="stats-replay-row flex w-full items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-left transition"
            >
              <TrackCover item={item} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {item.title}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.artist}
                </div>
              </div>
              <div className="text-xs font-bold text-accent-action">
                {index + 1}
              </div>
            </button>
          ))
        ) : (
          <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
            {t("stats.replay.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-dark-card rounded-lg px-4 py-3">
      <div className="stats-muted-label text-[10px] font-black uppercase tracking-[0.18em]">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-text-primary">{value}</div>
    </div>
  );
}

function SignalCard({
  icon: Icon,
  label,
  title,
  body,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="stats-card rounded-[12px] p-5">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-accent-action">
        <Icon size={13} />
        {label}
      </div>
      <div className="mt-3 text-xl font-black tracking-[-0.05em] text-text-primary">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}

function NarrativeTile({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  index: number;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "stats-narrative-tile rounded-[12px] p-5",
        NARRATIVE_TONES[index % NARRATIVE_TONES.length],
      )}
    >
      <div className="stats-muted-label text-[10px] font-black uppercase tracking-[0.22em]">
        {t("stats.narrative.signal", {
          number: String(index + 1).padStart(2, "0"),
        })}
      </div>
      <div className="mt-3 text-xl font-black tracking-[-0.05em] text-text-primary">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}

function SoundProfileCard({
  profile,
  genres,
  skipRate,
}: {
  profile: SoundProfile;
  genres: StatsGenre[];
  skipRate: number;
}) {
  const { t } = useTranslation();
  const genreLabels = normalizeGenreLabels(genres);

  return (
    <div className="stats-card rounded-[12px] p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {t("stats.soundProfile.title")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("stats.soundProfile.subtitle")}
          </p>
        </div>
        <Activity className="text-accent-action" size={22} />
      </div>

      <div className="space-y-4">
        <ProfileBar
          label={t("stats.soundProfile.energy")}
          value={profile.energy}
        />
        <ProfileBar
          label={t("stats.soundProfile.movement")}
          value={profile.danceability}
        />
        <ProfileBar
          label={t("stats.soundProfile.brightness")}
          value={profile.valence}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("stats.soundProfile.avgBpm")}
          value={profile.bpm ? String(profile.bpm) : "—"}
        />
        <MiniStat
          label={t("stats.soundProfile.skipRate")}
          value={formatStatsPercent(skipRate)}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {genreLabels.map((genre) => (
          <span
            key={genre}
            className="rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs font-bold text-accent-action"
          >
            {genre}
          </span>
        ))}
        {!genreLabels.length ? (
          <span className="text-sm text-text-muted">
            {t("stats.soundProfile.genreEmpty")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ListeningPulseCard({
  story,
  points,
  loading,
}: {
  story?: StatsStory;
  points: StatsTrendPoint[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const activePoints = points.filter(
    (point) => point.play_count > 0 || point.minutes_listened > 0,
  );
  const strongestDay = activePoints.reduce<StatsTrendPoint | null>(
    (strongest, point) =>
      !strongest || point.minutes_listened > strongest.minutes_listened
        ? point
        : strongest,
    null,
  );
  const totalMinutes = points.reduce(
    (sum, point) => sum + point.minutes_listened,
    0,
  );
  const averageActiveMinutes = activePoints.length
    ? totalMinutes / activePoints.length
    : 0;
  const consistency = points.length ? activePoints.length / points.length : 0;
  const rhythm = story?.rhythm;

  return (
    <div className="stats-card rounded-[12px] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {t("stats.rhythm.title")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("stats.rhythm.subtitle")}
          </p>
        </div>
        <CalendarDays className="text-accent-action" size={22} />
      </div>

      {loading ? (
        <PanelLoading />
      ) : activePoints.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label={t("stats.rhythm.strongestDay")}
              value={
                strongestDay
                  ? formatTrendDay(strongestDay.day, i18n.language)
                  : "—"
              }
            />
            <MiniStat
              label={t("stats.rhythm.peakHour")}
              value={rhythm?.peak_hour_label ?? "—"}
            />
            <MiniStat
              label={t("stats.rhythm.avgActiveDay")}
              value={formatStatsMinutes(averageActiveMinutes)}
            />
          </div>

          <PulseConstellation points={points} />

          <div className="stats-dark-card mt-4 rounded-xl p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-action">
              {t("stats.rhythm.cadence")}
            </div>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t("stats.rhythm.activityDays", {
                percent: formatStatsPercent(consistency),
              })}
              {rhythm?.peak_weekday
                ? ` ${t("stats.rhythm.strongestWeekday", {
                    weekday: formatWeekdayLabel(
                      rhythm.peak_weekday,
                      i18n.language,
                    ),
                  })}`
                : ""}
            </p>
          </div>
        </>
      ) : (
        <PanelEmpty text={t("stats.rhythm.empty")} />
      )}
    </div>
  );
}

function PulseConstellation({ points }: { points: StatsTrendPoint[] }) {
  const { t, i18n } = useTranslation();
  const visible = points.slice(-18);
  const maxMinutes = Math.max(
    ...visible.map((point) => point.minutes_listened),
    1,
  );
  const coordinates = visible.map((point, index) => {
    const intensity = Math.min(1, point.minutes_listened / maxMinutes);
    const x = visible.length > 1 ? 5 + (index / (visible.length - 1)) * 90 : 50;
    const y = 78 - intensity * 52;
    return { point, intensity, x, y };
  });
  const polyline = coordinates
    .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  return (
    <div className="stats-pulse-surface mt-5 rounded-[12px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-action">
            {t("stats.rhythm.dailySignalMap")}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("stats.rhythm.dailySignalDescription")}
          </p>
        </div>
        <div className="stats-muted-pill rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]">
          {t("stats.rhythm.dayCount", { count: visible.length })}
        </div>
      </div>

      <div className="stats-pulse-plot relative h-36 rounded-xl">
        <div className="stats-pulse-grid pointer-events-none absolute inset-3 rounded-xl opacity-50" />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={polyline}
            fill="none"
            className="stats-pulse-line"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {coordinates.map(({ point, intensity, x, y }, index) => {
          const size = 0.65 + intensity * 1.25;
          const completionRate = point.play_count
            ? point.complete_play_count / point.play_count
            : 0;
          const skipRate = point.play_count
            ? point.skip_count / point.play_count
            : 0;
          const isActive = point.play_count > 0 || point.minutes_listened > 0;

          return (
            <div
              key={point.day}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 hover:z-40 focus-within:z-40"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <button
                type="button"
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-full outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-primary/70",
                  isActive
                    ? "text-accent-action hover:scale-110"
                    : "stats-pulse-point-idle",
                )}
                aria-label={`${formatTrendDay(
                  point.day,
                  i18n.language,
                )}: ${formatStatsMinutes(point.minutes_listened)}, ${t(
                  "common.playCount",
                  { count: point.play_count },
                )}`}
              >
                <span
                  className={cn(
                    "absolute rounded-full blur-md transition",
                    isActive
                      ? "bg-accent-action/25"
                      : "stats-pulse-point-idle-glow",
                  )}
                  style={{
                    height: `${size * 1.45}rem`,
                    width: `${size * 1.45}rem`,
                  }}
                />
                <span
                  className={cn(
                    "relative rounded-full border transition",
                    isActive
                      ? "stats-pulse-point-active border-accent-action/55 bg-accent-action"
                      : "stats-pulse-point-idle-dot",
                  )}
                  style={{ height: `${size}rem`, width: `${size}rem` }}
                />
              </button>

              <div
                className={cn(
                  "stats-pulse-tooltip pointer-events-none absolute bottom-full z-app-popover mb-3 w-64 -translate-x-1/2 rounded-[12px] p-3 text-left opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100",
                  index < 2
                    ? "left-0 translate-x-0"
                    : index > coordinates.length - 3
                      ? "right-0 translate-x-0"
                      : "left-1/2",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="stats-pulse-tooltip-title text-sm font-black">
                      {formatTrendDay(point.day, i18n.language)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-accent-action">
                      {formatShortWeekday(point.day, i18n.language)}
                    </div>
                  </div>
                  <div className="rounded-full border border-accent-action/20 bg-accent-action/10 px-2.5 py-1 text-[10px] font-black text-accent-action">
                    {formatStatsMinutes(point.minutes_listened)}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <TooltipMetric
                    label={t("stats.metrics.plays")}
                    value={String(point.play_count)}
                  />
                  <TooltipMetric
                    label={t("stats.rhythm.done")}
                    value={String(point.complete_play_count)}
                  />
                  <TooltipMetric
                    label={t("stats.rhythm.skips")}
                    value={String(point.skip_count)}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <TooltipMeter
                    label={t("stats.rhythm.completion")}
                    value={completionRate}
                  />
                  <TooltipMeter
                    label={t("stats.rhythm.skipPressure")}
                    value={skipRate}
                  />
                </div>
                <div className="mt-3 text-xs leading-5 text-text-muted">
                  {isActive
                    ? t("stats.rhythm.completedAcross", {
                        complete: point.complete_play_count,
                        total: point.play_count,
                      })
                    : t("stats.rhythm.noDaySignal")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TooltipMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-tooltip-metric rounded-xl px-2.5 py-2">
      <div className="stats-tooltip-label text-[9px] font-black uppercase tracking-[0.16em]">
        {label}
      </div>
      <div className="stats-tooltip-value mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function TooltipMeter({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="stats-tooltip-meter-label mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em]">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="stats-tooltip-meter-track h-1.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-accent-action"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}

function ProfileBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="stats-profile-label font-bold uppercase tracking-[0.16em]">
          {label}
        </span>
        <span className="font-black text-text-primary">{percent}%</span>
      </div>
      <div className="stats-profile-track h-3 overflow-hidden rounded-full">
        <div
          className="stats-profile-fill h-full rounded-full"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}

function normalizeGenreLabels(genres: StatsGenre[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const genre of genres) {
    for (const rawLabel of genre.genre_name.split(",")) {
      const label = rawLabel.trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
  }
  return labels.slice(0, 8);
}

function formatTrendDay(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatShortWeekday(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { weekday: "long" });
}

const WEEKDAY_INDEX_BY_ENGLISH = new Map(
  [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ].map((weekday, index) => [weekday, index] as const),
);

function formatWeekdayLabel(weekday: string, locale: string): string {
  const weekdayIndex = WEEKDAY_INDEX_BY_ENGLISH.get(weekday.toLowerCase());
  if (weekdayIndex == null) return weekday;
  const date = new Date(Date.UTC(2026, 0, 4 + weekdayIndex, 12));
  return date.toLocaleDateString(locale, { weekday: "long" });
}

function TopTracksPanel({
  items,
  loading,
  onPlayTrack,
}: {
  items: StatsTrack[];
  loading: boolean;
  onPlayTrack: (item: StatsTrack) => void;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topTracks.title")}
      subtitle={t("stats.topTracks.subtitle")}
      icon={Music2}
    >
      <div className="space-y-2">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.map((item, index) => (
            <button
              key={`${item.track_id ?? item.track_path ?? item.title}-${index}`}
              onClick={() => onPlayTrack(item)}
              className="stats-list-row group flex w-full items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-left transition"
            >
              <div className="w-7 text-center text-xs font-black text-text-muted">
                {index + 1}
              </div>
              <TrackCover item={item} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {item.title}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.artist} · {item.album}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black text-text-primary">
                  {item.play_count}
                </div>
                <div className="text-[11px] text-text-muted">
                  {formatStatsMinutes(item.minutes_listened)}
                </div>
              </div>
            </button>
          ))
        ) : (
          <PanelEmpty text={t("stats.topTracks.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistsPanel({
  items,
  loading,
}: {
  items: StatsArtist[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topArtists.title")}
      subtitle={t("stats.topArtists.subtitle")}
      icon={Flame}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items
            .slice(0, 6)
            .map((item, index) => (
              <TopArtistCard
                key={`${item.artist_name}-${index}`}
                item={item}
                index={index}
              />
            ))
        ) : (
          <PanelEmpty text={t("stats.topArtists.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistCard({ item, index }: { item: StatsArtist; index: number }) {
  const { t } = useTranslation();
  const photo = artistPhotoApiUrl(
    {
      artistId: item.artist_id,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    },
    { size: 640 },
  );

  return (
    <Link
      to={artistPagePath({
        artistId: item.artist_id,
        globalArtistUid: item.global_artist_uid,
        artistSlug: item.artist_slug,
        artistName: item.artist_name,
      })}
      className="stats-artist-card group relative min-h-40 overflow-hidden rounded-xl p-4 transition"
    >
      {photo ? (
        <CrateImage
          src={photo}
          alt=""
          className="absolute inset-0 h-full w-full object-cover grayscale opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70"
          loading="lazy"
        />
      ) : (
        <div className="stats-artist-placeholder absolute inset-0" />
      )}
      <div className="stats-artist-overlay absolute inset-0" />
      <div className="stats-artist-index absolute -bottom-6 -right-1 text-[8.5rem] font-black leading-none tracking-[-0.12em]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative z-10 flex min-h-32 flex-col justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-action">
          {t("stats.rank", { rank: index + 1 })}
        </div>
        <div>
          <div className="stats-artist-title line-clamp-2 text-3xl font-black uppercase leading-[0.86] tracking-[-0.08em]">
            {item.artist_name}
          </div>
          <div className="stats-artist-meta mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.12em]">
            <span>{t("common.playCount", { count: item.play_count })}</span>
            <span>{formatStatsMinutes(item.minutes_listened)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function TopAlbumsPanel({
  items,
  loading,
}: {
  items: StatsAlbum[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topAlbums.title")}
      subtitle={t("stats.topAlbums.subtitle")}
      icon={Disc3}
      className="mt-8"
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.slice(0, 12).map((item, index) => (
            <Link
              key={`${item.artist}-${item.album}-${index}`}
              to={albumPagePath({
                albumId: item.album_id,
                globalAlbumUid: item.global_album_uid,
                albumSlug: item.album_slug,
                artistSlug: item.artist_slug,
                artistName: item.artist,
                albumName: item.album,
              })}
              className="group min-w-0"
            >
              <div className="stats-album-cover relative aspect-square overflow-hidden rounded-xl">
                {albumCoverApiUrl(
                  {
                    albumId: item.album_id,
                    globalAlbumUid: item.global_album_uid,
                    albumSlug: item.album_slug,
                    artistSlug: item.artist_slug,
                    artistName: item.artist,
                    albumName: item.album,
                  },
                  { size: 384 },
                ) ? (
                  <CrateImage
                    src={albumCoverApiUrl(
                      {
                        albumId: item.album_id,
                        globalAlbumUid: item.global_album_uid,
                        albumSlug: item.album_slug,
                        artistSlug: item.artist_slug,
                        artistName: item.artist,
                        albumName: item.album,
                      },
                      { size: 384 },
                    )}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-accent-action">
                    <Disc3 size={28} />
                  </div>
                )}
                <div className="stats-album-rank absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-black">
                  #{index + 1}
                </div>
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-text-primary">
                {item.album}
              </div>
              <div className="truncate text-xs text-text-muted">
                {item.artist}
              </div>
            </Link>
          ))
        ) : (
          <PanelEmpty text={t("stats.topAlbums.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function StatsPanel({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("stats-card rounded-[12px] p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {title}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        </div>
        <Icon className="text-accent-action" size={22} />
      </div>
      {children}
    </section>
  );
}

function TrackCover({
  item,
  size = "md",
}: {
  item: StatsTrack;
  size?: "sm" | "md";
}) {
  const cover = albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumSlug: item.album_slug,
      artistName: item.artist,
      albumName: item.album,
    },
    { size: 160 },
  );
  return (
    <div
      className={cn(
        "stats-track-cover shrink-0 overflow-hidden rounded-xl",
        size === "sm" ? "h-10 w-10" : "h-12 w-12",
      )}
    >
      {cover ? (
        <CrateImage
          src={cover}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-accent-action">
          <Music2 size={size === "sm" ? 16 : 18} />
        </div>
      )}
    </div>
  );
}

function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {t("common.loadingShort")}
    </div>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {text}
    </div>
  );
}

interface SoundProfile {
  energy: number;
  danceability: number;
  valence: number;
  bpm: number | null;
}

function buildSoundProfile(items: StatsTrack[]): SoundProfile {
  const average = (field: "energy" | "danceability" | "valence") => {
    const values = items
      .map((item) => item[field])
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const bpmValues = items
    .map((item) => item.bpm)
    .filter((value): value is number => typeof value === "number" && value > 0);

  return {
    energy: average("energy"),
    danceability: average("danceability"),
    valence: average("valence"),
    bpm: bpmValues.length
      ? Math.round(
          bpmValues.reduce((sum, value) => sum + value, 0) / bpmValues.length,
        )
      : null,
  };
}
