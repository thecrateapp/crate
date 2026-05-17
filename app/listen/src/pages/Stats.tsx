import { useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Compass,
  Disc3,
  Flame,
  Music2,
  Play,
  Repeat2,
  Users,
} from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { WindowPicker } from "@/components/stats/StatsPanels";
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

const WINDOW_COPY: Record<StatsWindow, { title: string; label: string }> = {
  "7d": { title: "Last 7 days", label: "Week" },
  "30d": { title: "Last 30 days", label: "Month" },
  "90d": { title: "Last 90 days", label: "Season" },
  "365d": { title: "Last year", label: "Year" },
  all_time: { title: "All-time", label: "Archive" },
};

const STATS_WINDOWS: StatsWindow[] = ["7d", "30d", "90d", "365d", "all_time"];

function normalizeWindowParam(value: string | null): StatsWindow {
  return STATS_WINDOWS.includes(value as StatsWindow)
    ? (value as StatsWindow)
    : "30d";
}

function normalizeMonthParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function formatMonthTitle(month: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function Stats() {
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
  const period = selectedMonth
    ? { title: formatMonthTitle(selectedMonth), label: "Month" }
    : WINDOW_COPY[selectedWindow];

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
      ),
    [overview, replay, topArtistItems, topTrackItems],
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
    ? "Crate pulse"
    : isUserStats && subjectName
      ? `${subjectName}'s sound`
      : "Your sound";
  const heroBody = isGlobalStats
    ? "A replay-style read on the whole instance: shared obsessions, global momentum, sound profile, and the records shaping Crate."
    : isUserStats
      ? "A replay-style read on this listener: obsessions, momentum, sound profile, and the records that owned this window."
      : "A replay-style read on what you actually lived with: obsessions, momentum, sound profile, and the records that owned this window.";

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
      name: replay?.title || "Replay",
    });
  };

  return (
    <div className="relative -mx-4 -mt-2 overflow-hidden px-4 pb-12 pt-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_82%_4%,rgba(244,114,182,0.13),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-primary shadow-[0_0_30px_rgba(34,211,238,0.14)]">
            <BarChart3 size={12} />
            Listening DNA
          </div>
          <h1 className="mt-4 max-w-4xl text-[clamp(2.65rem,8vw,7.5rem)] font-black uppercase leading-[0.82] tracking-[-0.085em] text-foreground">
            {heroTitle}
            <span className="block text-primary">decoded</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            {heroBody}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {!isUserStats ? (
              <>
                <ScopeLink active={!isGlobalStats} to="/stats">
                  Your DNA
                </ScopeLink>
                <ScopeLink active={isGlobalStats} to="/stats/global">
                  Crate Pulse
                </ScopeLink>
              </>
            ) : username ? (
              <ScopeLink active={false} to={`/users/${username}`}>
                Back to profile
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
        <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#101116] p-5 shadow-2xl shadow-black/35 sm:p-7">
          <StatsCoverMosaic tracks={coverTracks} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_18%,rgba(34,211,238,0.28),transparent_24%),linear-gradient(90deg,rgba(9,10,15,0.92)_0%,rgba(9,10,15,0.58)_44%,rgba(9,10,15,0.18)_100%),linear-gradient(180deg,rgba(9,10,15,0.18),rgba(9,10,15,0.9))]" />
          <div className="relative z-10 flex min-h-[460px] flex-col justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
                {period.label}
              </span>
              <span className="rounded-full border border-primary/25 bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                {period.title}
              </span>
            </div>

            <div>
              <div className="max-w-3xl text-[clamp(3.8rem,13vw,10rem)] font-black uppercase leading-[0.75] tracking-[-0.1em] text-white">
                {leadGenre?.genre_name || leadArtist?.artist_name || "Crate"}
              </div>
              <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
                <HeroMetric
                  label="Minutes"
                  value={formatStatsMinutes(overview?.minutes_listened ?? 0)}
                />
                <HeroMetric
                  label="Plays"
                  value={
                    overview?.play_count ? String(overview.play_count) : "0"
                  }
                />
                <HeroMetric
                  label="Active days"
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
              label="Obsession"
              title={leadTrack?.title || "No dominant track yet"}
              body={
                leadTrack
                  ? `${leadTrack.artist} kept surfacing with ${leadTrack.play_count} plays.`
                  : "Start listening and Crate will find the track that keeps pulling you back."
              }
            />
            <SignalCard
              icon={Compass}
              label={topDiscovery ? "Discovery" : "Gravity"}
              title={
                topDiscovery?.artist_name ||
                leadArtist?.artist_name ||
                "No leading artist yet"
              }
              body={
                topDiscovery
                  ? `${topDiscovery.play_count} first-window plays. New signal, not old habit.`
                  : leadArtist
                    ? `${formatStatsMinutes(
                        leadArtist.minutes_listened,
                      )} with ${leadArtist.play_count} plays.`
                    : "Your strongest artist signal will appear here."
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
          <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-muted-foreground lg:col-span-3">
            Keep listening and this page will start writing your recap.
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
        <div className="mt-8 rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
          <h2 className="text-xl font-black text-foreground">
            Your stats are waiting for signal
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Play a few albums and this turns into your personal listening
            dossier.
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
          ? "border-primary/30 bg-primary/15 text-primary"
          : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80",
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
  if (!affinity) return null;

  const reasons = affinity.affinity_reasons ?? [];
  return (
    <section className="mt-8 overflow-hidden rounded-[1.75rem] border border-primary/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.13),rgba(255,255,255,0.035)_45%,rgba(244,114,182,0.1))] p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/15 text-primary">
            <Users size={20} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
              Listener match
            </div>
            <h2 className="mt-2 text-3xl font-black uppercase leading-none tracking-[-0.06em] text-foreground">
              {affinity.affinity_score}% affinity
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {subject
                ? `Your listening overlaps with ${subject} across the signals below.`
                : "Your listening overlaps with this listener across the signals below."}
            </p>
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-white/65">
          {affinity.affinity_band.replace("_", " ")}
        </div>
      </div>
      {reasons.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/70"
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
  if (!story) return null;
  const mover = fallbackMover ?? story.movers[0];
  const discovery = fallbackDiscovery ?? story.discoveries[0];
  const comeback = fallbackComeback ?? story.comebacks[0];
  const rhythm = story.rhythm;

  if (!mover && !discovery && !comeback && !rhythm.peak_hour_label) return null;

  return (
    <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StorySignalCard
        label="Rising"
        title={mover?.artist_name || "No surge yet"}
        body={
          mover?.delta_play_count
            ? `+${mover.delta_play_count} plays versus the previous window.`
            : "Crate will highlight artists gaining momentum here."
        }
      />
      <StorySignalCard
        label="New blood"
        title={discovery?.artist_name || "No new obsession yet"}
        body={
          discovery
            ? `${discovery.play_count} plays from an artist that was not in your prior history.`
            : "New-to-you artists will show up here."
        }
      />
      <StorySignalCard
        label="Comeback"
        title={comeback?.artist_name || "No comeback yet"}
        body={
          comeback
            ? `${comeback.play_count} plays after a long quiet stretch.`
            : "Artists returning after a long gap will appear here."
        }
      />
      <StorySignalCard
        label="Peak ritual"
        title={rhythm.peak_hour_label || rhythm.peak_weekday || "No rhythm yet"}
        body={
          rhythm.peak_weekday
            ? `${rhythm.peak_weekday} and ${
                rhythm.peak_hour_label ?? "your peak hour"
              } carried the strongest signal.`
            : "Your strongest listening hour and day will land here."
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
    <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5">
      <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
          {label}
        </div>
        <div className="mt-3 line-clamp-2 text-2xl font-black uppercase leading-[0.9] tracking-[-0.07em] text-foreground">
          {title}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black tracking-[-0.04em] text-white">
        {value}
      </div>
    </div>
  );
}

function StatsCoverMosaic({ tracks }: { tracks: StatsTrack[] }) {
  const covers = tracks
    .map((track) =>
      albumCoverApiUrl(
        { albumId: track.album_id, albumSlug: track.album_slug },
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
              "relative min-h-40 overflow-hidden bg-white/[0.04]",
              index % 3 === 0 && "scale-105",
            )}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                className="h-full w-full object-cover grayscale-[35%] saturate-[0.85]"
                loading={index < 4 ? "eager" : "lazy"}
              />
            ) : (
              <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.35),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02))]" />
            )}
            <div className="absolute inset-0 bg-black/35" />
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
  return (
    <div className="rounded-[1.75rem] border border-primary/20 bg-primary/[0.08] p-5 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-black/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
            <Repeat2 size={12} />
            Replay
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-[-0.06em] text-foreground">
            {replay?.title || "Replay"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {replay?.subtitle || "A playable snapshot of this window."}
          </p>
        </div>
        <button
          onClick={onPlay}
          disabled={!items.length}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/20 transition hover:scale-105 disabled:opacity-50"
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat label="Tracks" value={String(replay?.track_count ?? 0)} />
        <MiniStat
          label="Minutes"
          value={formatStatsMinutes(replay?.minutes_listened ?? 0)}
        />
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
            Loading replay...
          </div>
        ) : items.length ? (
          items.slice(0, 5).map((item, index) => (
            <button
              key={`${item.track_id ?? item.track_path ?? item.title}-${index}`}
              onClick={() => onPlayTrack(item)}
              className="flex w-full items-center gap-3 rounded-2xl border border-transparent bg-black/15 px-3 py-2.5 text-left transition hover:border-white/10 hover:bg-white/5"
            >
              <TrackCover item={item} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {item.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.artist}
                </div>
              </div>
              <div className="text-xs font-bold text-primary">{index + 1}</div>
            </button>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
            Your replay will appear after a little more listening.
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-foreground">{value}</div>
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
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
        <Icon size={13} />
        {label}
      </div>
      <div className="mt-3 text-xl font-black tracking-[-0.05em] text-foreground">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
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
  const tones = [
    "from-cyan-400/18 via-white/[0.035] to-transparent",
    "from-rose-400/16 via-white/[0.035] to-transparent",
    "from-amber-300/16 via-white/[0.035] to-transparent",
  ];

  return (
    <div
      className={cn(
        "rounded-[1.75rem] border border-white/10 bg-gradient-to-br p-5",
        tones[index % tones.length],
      )}
    >
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
        Signal 0{index + 1}
      </div>
      <div className="mt-3 text-xl font-black tracking-[-0.05em] text-foreground">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
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
  const genreLabels = normalizeGenreLabels(genres);

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-foreground">
            Your sound profile
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Built from the tracks that dominated this window.
          </p>
        </div>
        <Activity className="text-primary" size={22} />
      </div>

      <div className="space-y-4">
        <ProfileBar label="Energy" value={profile.energy} />
        <ProfileBar label="Movement" value={profile.danceability} />
        <ProfileBar label="Brightness" value={profile.valence} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label="Avg BPM"
          value={profile.bpm ? String(profile.bpm) : "—"}
        />
        <MiniStat label="Skip rate" value={formatStatsPercent(skipRate)} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {genreLabels.map((genre) => (
          <span
            key={genre}
            className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
          >
            {genre}
          </span>
        ))}
        {!genreLabels.length ? (
          <span className="text-sm text-muted-foreground">
            Genre signal will appear here.
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
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-foreground">
            Listening rhythm
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Less graph, more signal: when this window actually happened.
          </p>
        </div>
        <CalendarDays className="text-primary" size={22} />
      </div>

      {loading ? (
        <PanelLoading />
      ) : activePoints.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label="Strongest day"
              value={strongestDay ? formatTrendDay(strongestDay.day) : "—"}
            />
            <MiniStat
              label="Peak hour"
              value={rhythm?.peak_hour_label ?? "—"}
            />
            <MiniStat
              label="Avg active day"
              value={formatStatsMinutes(averageActiveMinutes)}
            />
          </div>

          <PulseConstellation points={points} />

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
              Cadence
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {formatStatsPercent(consistency)} of days had listening activity.
              {rhythm?.peak_weekday
                ? ` ${rhythm.peak_weekday} carried the strongest weekday signal.`
                : ""}
            </p>
          </div>
        </>
      ) : (
        <PanelEmpty text="Play a few tracks and Crate will find your listening cadence." />
      )}
    </div>
  );
}

function PulseConstellation({ points }: { points: StatsTrendPoint[] }) {
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
    <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.18))] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
            Daily signal map
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Dot size and height follow listening intensity.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
          {visible.length} days
        </div>
      </div>

      <div className="relative h-36 rounded-2xl border border-white/[0.06] bg-black/20">
        <div className="pointer-events-none absolute inset-3 rounded-xl bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_28px] opacity-50" />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={polyline}
            fill="none"
            stroke="rgba(34,211,238,0.34)"
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
                    ? "text-primary hover:scale-110"
                    : "text-white/18 hover:text-white/35",
                )}
                aria-label={`${formatTrendDay(point.day)}: ${formatStatsMinutes(
                  point.minutes_listened,
                )}, ${point.play_count} plays`}
              >
                <span
                  className={cn(
                    "absolute rounded-full blur-md transition",
                    isActive ? "bg-primary/25" : "bg-white/5",
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
                      ? "border-primary/55 bg-primary shadow-[0_0_28px_rgba(34,211,238,0.28)]"
                      : "border-white/15 bg-white/10",
                  )}
                  style={{ height: `${size}rem`, width: `${size}rem` }}
                />
              </button>

              <div
                className={cn(
                  "pointer-events-none absolute bottom-full z-50 mb-3 w-64 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0d0f15]/95 p-3 text-left opacity-0 shadow-2xl shadow-black/45 backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100",
                  index < 2
                    ? "left-0 translate-x-0"
                    : index > coordinates.length - 3
                      ? "right-0 translate-x-0"
                      : "left-1/2",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-white">
                      {formatTrendDay(point.day)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                      {formatShortWeekday(point.day)}
                    </div>
                  </div>
                  <div className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">
                    {formatStatsMinutes(point.minutes_listened)}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <TooltipMetric
                    label="Plays"
                    value={String(point.play_count)}
                  />
                  <TooltipMetric
                    label="Done"
                    value={String(point.complete_play_count)}
                  />
                  <TooltipMetric
                    label="Skips"
                    value={String(point.skip_count)}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <TooltipMeter label="Completion" value={completionRate} />
                  <TooltipMeter label="Skip pressure" value={skipRate} />
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">
                  {isActive
                    ? `${point.complete_play_count} completed plays across ${point.play_count} total plays.`
                    : "No listening signal recorded this day."}
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
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/35">
        {label}
      </div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function TooltipMeter({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/42">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-primary"
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
        <span className="font-bold uppercase tracking-[0.16em] text-white/45">
          {label}
        </span>
        <span className="font-black text-foreground">{percent}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#22d3ee,#eab308,#fb7185)]"
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

function formatTrendDay(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatShortWeekday(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "long" });
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
  return (
    <StatsPanel
      title="Top tracks"
      subtitle="The songs that made the loudest dent."
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
              className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-left transition hover:border-white/10 hover:bg-white/5"
            >
              <div className="w-7 text-center text-xs font-black text-muted-foreground">
                {index + 1}
              </div>
              <TrackCover item={item} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {item.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.artist} · {item.album}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black text-foreground">
                  {item.play_count}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatStatsMinutes(item.minutes_listened)}
                </div>
              </div>
            </button>
          ))
        ) : (
          <PanelEmpty text="No top tracks yet." />
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
  return (
    <StatsPanel
      title="Top artists"
      subtitle="Your strongest gravity wells."
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
          <PanelEmpty text="No top artists yet." />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistCard({ item, index }: { item: StatsArtist; index: number }) {
  const photo = artistPhotoApiUrl(
    { artistId: item.artist_id, artistSlug: item.artist_slug },
    { size: 640 },
  );

  return (
    <Link
      to={artistPagePath({
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
      })}
      className="group relative min-h-40 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4 transition hover:border-primary/35"
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          className="absolute inset-0 h-full w-full object-cover grayscale opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_26%_18%,rgba(34,211,238,0.28),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,12,0.92),rgba(3,7,12,0.46)_58%,rgba(3,7,12,0.78)),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.78))]" />
      <div className="absolute -bottom-6 -right-1 text-[8.5rem] font-black leading-none tracking-[-0.12em] text-white/[0.14]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative z-10 flex min-h-32 flex-col justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
          Rank #{index + 1}
        </div>
        <div>
          <div className="line-clamp-2 text-3xl font-black uppercase leading-[0.86] tracking-[-0.08em] text-white">
            {item.artist_name}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/62">
            <span>{item.play_count} plays</span>
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
  return (
    <StatsPanel
      title="Top albums"
      subtitle="Records that owned the window."
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
                albumSlug: item.album_slug,
              })}
              className="group min-w-0"
            >
              <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                {albumCoverApiUrl(
                  { albumId: item.album_id, albumSlug: item.album_slug },
                  { size: 384 },
                ) ? (
                  <img
                    src={albumCoverApiUrl(
                      { albumId: item.album_id, albumSlug: item.album_slug },
                      { size: 384 },
                    )}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-primary">
                    <Disc3 size={28} />
                  </div>
                )}
                <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black text-white">
                  #{index + 1}
                </div>
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-foreground">
                {item.album}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {item.artist}
              </div>
            </Link>
          ))
        ) : (
          <PanelEmpty text="No top albums yet." />
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
    <section
      className={cn(
        "rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-foreground">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Icon className="text-primary" size={22} />
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
    { albumId: item.album_id, albumSlug: item.album_slug },
    { size: 160 },
  );
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]",
        size === "sm" ? "h-10 w-10" : "h-12 w-12",
      )}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-primary">
          <Music2 size={size === "sm" ? 16 : 18} />
        </div>
      )}
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
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
