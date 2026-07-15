import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Music,
  Play,
  Radio as RadioIcon,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "@crate/ui/icons";
import { toast } from "sonner";

import {
  SectionHeader,
  SectionLoading,
  SectionRail,
} from "@/components/home/HomeSections";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { startShapedRadio, checkDiscoveryAvailable } from "@/lib/radio";
import { cn } from "@/lib/utils";

type EndpointType = "artist" | "genre" | "album" | "track";
type StationSeedType = "artist" | "genre";

interface PersonalizedRadioStation {
  type: StationSeedType;
  seed_type: StationSeedType;
  seed_value: string;
  seed_label: string;
  seed_subtitle?: string | null;
  title: string;
  subtitle?: string | null;
  play_count?: number;
  minutes_listened?: number;
  artist_id?: number | null;
  global_artist_uid?: string | null;
  artist_entity_uid?: string | null;
  artist_slug?: string | null;
  artist_name?: string | null;
  genre_slug?: string | null;
  genre_name?: string | null;
  cover_url?: string | null;
}

interface PersonalizedRadioStationsResponse {
  artist_stations: PersonalizedRadioStation[];
  genre_stations: PersonalizedRadioStation[];
}

interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
}

function stationTypeLabelKey(station: PersonalizedRadioStation): string {
  return station.seed_type === "genre"
    ? "radio.stationType.genre"
    : "radio.stationType.artist";
}

function stationLabel(station: PersonalizedRadioStation): string {
  return (
    station.seed_label ||
    station.genre_name ||
    station.artist_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

function stationArtwork(station: PersonalizedRadioStation): string | null {
  if (station.type === "genre") {
    return resolveMaybeApiAssetUrl(station.cover_url) || null;
  }
  const explicitCover = resolveMaybeApiAssetUrl(station.cover_url);
  if (explicitCover) return explicitCover;
  return (
    artistPhotoApiUrl(
      {
        artistId: station.artist_id,
        globalArtistUid: station.global_artist_uid,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name || station.seed_label,
      },
      { size: 320 },
    ) || null
  );
}

function StationCard({
  station,
  disabled,
  onStart,
}: {
  station: PersonalizedRadioStation;
  disabled: boolean;
  onStart: (station: PersonalizedRadioStation) => void;
}) {
  const { t } = useTranslation();
  const label = stationLabel(station);
  const imageUrl = stationArtwork(station);
  const plays = station.play_count || 0;
  const typeLabel = t(stationTypeLabelKey(station));

  return (
    <button
      type="button"
      aria-label={t("radio.station.startAria", { label, type: typeLabel })}
      disabled={disabled}
      onClick={() => onStart(station)}
      className="group relative aspect-square snap-start overflow-hidden rounded-xl border border-white/8 bg-white/[0.03] text-left shadow-[0_18px_70px_rgba(0,0,0,0.24)] transition duration-300 hover:border-primary/30 hover:shadow-[0_18px_80px_rgba(10,209,241,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-85 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-100"
          loading="lazy"
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(10,209,241,0.24),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.01))]",
            station.type === "genre" && "bg-primary/10",
          )}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/10" />
      <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
        <span className="rounded-full border border-white/12 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65 backdrop-blur-md">
          {typeLabel}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-black opacity-0 shadow-[0_0_24px_rgba(10,209,241,0.32)] transition duration-300 group-hover:opacity-100">
          <Play size={14} className="translate-x-px" />
        </span>
      </div>
      <div className="absolute inset-x-3 bottom-3">
        <div className="line-clamp-2 text-base font-semibold leading-tight text-white">
          {label}
        </div>
        {plays > 0 ? (
          <div className="mt-1 text-xs text-white/52">
            {t("common.playCount", { count: plays })}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function StationRail({
  title,
  subtitle,
  stations,
  loading,
  disabled,
  onStart,
}: {
  title: string;
  subtitle: string;
  stations: PersonalizedRadioStation[];
  loading: boolean;
  disabled: boolean;
  onStart: (station: PersonalizedRadioStation) => void;
}) {
  if (loading) {
    return (
      <section className="space-y-4">
        <SectionHeader title={title} subtitle={subtitle} />
        <SectionLoading />
      </section>
    );
  }

  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader title={title} subtitle={subtitle} />
      <SectionRail fit="square-card">
        {stations.map((station) => (
          <StationCard
            key={`${station.seed_type}-${station.seed_value}`}
            station={station}
            disabled={disabled}
            onStart={onStart}
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function RadioPage() {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const {
    data: stationGroups,
    loading: stationsLoading,
    error: stationsError,
  } = useApi<PersonalizedRadioStationsResponse>("/api/radio/stations");
  const [discoveryAvailable, setDiscoveryAvailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"seeded" | "discovery" | null>(
    null,
  );
  const [seedLabel, setSeedLabel] = useState("");

  // Seed picker state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    checkDiscoveryAvailable().then(setDiscoveryAvailable);
  }, []);

  const artistStations = stationGroups?.artist_stations ?? [];
  const genreStations = stationGroups?.genre_stations ?? [];

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const [searchData, genresData] = await Promise.all([
        api<{
          artists?: {
            id: number;
            entity_uid?: string;
            name: string;
            slug?: string;
          }[];
          albums?: {
            id: number;
            entity_uid?: string;
            name: string;
            artist: string;
            artist_entity_uid?: string;
            slug?: string;
          }[];
        }>(`/api/catalog/search?q=${encodeURIComponent(q)}&limit=5`),
        api<{ slug: string; name: string }[]>("/api/genres"),
      ]);
      const items: SearchResult[] = [];
      const qLower = q.toLowerCase();
      for (const g of genresData
        .filter((g) => g.name.toLowerCase().includes(qLower))
        .slice(0, 3)) {
        items.push({ type: "genre", value: g.slug, label: g.name });
      }
      for (const a of searchData.artists?.slice(0, 3) ?? []) {
        items.push({
          type: "artist",
          value: a.entity_uid || String(a.id),
          label: a.name,
          imageUrl: artistPhotoApiUrl({
            artistId: a.id,
            artistEntityUid: a.entity_uid,
            artistSlug: a.slug,
            artistName: a.name,
          }),
        });
      }
      for (const a of searchData.albums?.slice(0, 3) ?? []) {
        items.push({
          type: "album",
          value: a.entity_uid || String(a.id ?? 0),
          label: `${a.name} — ${a.artist}`,
          imageUrl: albumCoverApiUrl({
            albumId: a.id,
            albumEntityUid: a.entity_uid,
            artistEntityUid: a.artist_entity_uid,
            albumSlug: a.slug,
            albumName: a.name,
            artistName: a.artist,
          }),
        });
      }
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const startStation = async (station: PersonalizedRadioStation) => {
    setStarting(true);
    const seedValue =
      station.seed_value ||
      station.genre_slug ||
      (station.artist_id != null ? String(station.artist_id) : "");
    const result = await startShapedRadio(
      "seeded",
      station.seed_type,
      seedValue,
    );
    if (!result) {
      toast.error(t("radio.toasts.startFailed"));
      setStarting(false);
      return;
    }
    setActiveSession(result.sessionId);
    setActiveMode("seeded");
    setSeedLabel(result.seedLabel || stationLabel(station));
    playAll(result.tracks, 0, result.source);
    setStarting(false);
  };

  const startSeeded = async (seed: SearchResult) => {
    setStarting(true);
    setQuery("");
    setResults([]);
    const result = await startShapedRadio("seeded", seed.type, seed.value);
    if (!result) {
      toast.error(t("radio.toasts.startFailed"));
      setStarting(false);
      return;
    }
    setActiveSession(result.sessionId);
    setActiveMode("seeded");
    setSeedLabel(result.seedLabel);
    playAll(result.tracks, 0, result.source);
    setStarting(false);
  };

  const startDiscovery = async () => {
    setStarting(true);
    const result = await startShapedRadio("discovery");
    if (!result) {
      toast.error(t("radio.toasts.discoveryUnavailable"));
      setStarting(false);
      return;
    }
    setActiveSession(result.sessionId);
    setActiveMode("discovery");
    setSeedLabel(t("radio.discovery"));
    playAll(result.tracks, 0, result.source);
    setStarting(false);
  };

  return (
    <div className="animate-page-in space-y-7 px-4 py-6 sm:px-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.28)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(10,209,241,0.2),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_52%)]" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-black shadow-[0_0_34px_rgba(10,209,241,0.32)]">
              <RadioIcon size={24} />
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold leading-tight text-foreground">
                {t("radio.title")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/52">
                {t("radio.intro")}
              </p>
            </div>
          </div>

          <button
            onClick={startDiscovery}
            disabled={starting || !discoveryAvailable}
            className={cn(
              "group inline-flex min-h-12 items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold text-black transition duration-300",
              "bg-primary shadow-[0_0_28px_rgba(10,209,241,0.28)] hover:shadow-[0_0_38px_rgba(10,209,241,0.4)] disabled:opacity-40",
            )}
          >
            {starting ? (
              <Loader2 size={19} className="animate-spin" />
            ) : (
              <Sparkles size={19} />
            )}
            {t("radio.discovery")}
          </button>
        </div>
      </div>

      {activeMode === "discovery" ? (
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
            <span className="text-sm font-medium text-primary">
              {t("radio.discovery")}
            </span>
            <span className="text-[11px] text-white/35">
              {t("common.playing")}
            </span>
          </div>
        </div>
      ) : null}

      <StationRail
        title={t("radio.artistStations.title")}
        subtitle={t("radio.artistStations.subtitle")}
        stations={artistStations}
        loading={stationsLoading}
        disabled={starting}
        onStart={startStation}
      />

      <StationRail
        title={t("radio.genreStations.title")}
        subtitle={t("radio.genreStations.subtitle")}
        stations={genreStations}
        loading={stationsLoading}
        disabled={starting}
        onStart={startStation}
      />

      {stationsError ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
          {t("radio.errors.stations")}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <RadioIcon size={16} className="text-primary" />
          {t("radio.seed.title")}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            void search(e.target.value);
          }}
          placeholder={t("radio.seed.placeholder")}
          className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-foreground placeholder:text-white/25 focus:border-primary/35 focus:outline-none"
        />

        {searching && (
          <Loader2 size={14} className="mt-2 animate-spin text-primary" />
        )}

        {results.length > 0 && (
          <div className="mt-2 space-y-0.5 rounded-xl border border-white/8 bg-black/40 p-1.5">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.value}`}
                onClick={() => void startSeeded(r)}
                disabled={starting}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {r.imageUrl ? (
                  <img
                    src={r.imageUrl}
                    alt=""
                    className={`h-9 w-9 flex-shrink-0 bg-white/5 object-cover ${
                      r.type === "artist" ? "rounded-full" : "rounded-md"
                    }`}
                  />
                ) : (
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Music size={16} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="text-[10px] text-white/30">
                    {t("radio.seed.resultType", { type: r.type })}
                  </div>
                </div>
                <RadioIcon
                  size={14}
                  className="flex-shrink-0 text-primary/40"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active session info */}
      {activeSession && activeMode !== "discovery" && (
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
            <span className="text-sm font-medium text-primary">
              {seedLabel} Radio
            </span>
            <span className="text-[11px] text-white/30">
              {t("common.playing")}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/40">
            <ThumbsUp size={10} /> {t("radio.feedback.likePrefix")}{" "}
            <ThumbsDown size={10} /> {t("radio.feedback.dislikeSuffix")}
          </div>
        </div>
      )}
    </div>
  );
}
