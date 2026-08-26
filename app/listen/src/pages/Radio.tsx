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
import { CrateImage } from "@/components/artwork/CrateImage";
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
      className="radio-station-card group relative aspect-square snap-start overflow-hidden rounded-xl text-left transition duration-300"
    >
      {imageUrl ? (
        <CrateImage
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-85 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-100"
          loading="lazy"
        />
      ) : (
        <div
          className={cn("radio-station-placeholder absolute inset-0")}
          data-station-type={station.type}
        />
      )}
      <div className="radio-station-overlay absolute inset-0" />
      <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
        <span className="radio-station-type rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
          {typeLabel}
        </span>
        <span className="radio-station-play flex h-8 w-8 items-center justify-center rounded-full opacity-0 transition duration-300 group-hover:opacity-100">
          <Play size={14} className="translate-x-px" />
        </span>
      </div>
      <div className="absolute inset-x-3 bottom-3">
        <div className="radio-station-label line-clamp-2 text-base font-semibold leading-tight">
          {label}
        </div>
        {plays > 0 ? (
          <div className="radio-station-count mt-1 text-xs">
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
          imageUrl: artistPhotoApiUrl(
            {
              artistId: a.id,
              artistEntityUid: a.entity_uid,
              artistSlug: a.slug,
              artistName: a.name,
            },
            { size: 128 },
          ),
        });
      }
      for (const a of searchData.albums?.slice(0, 3) ?? []) {
        items.push({
          type: "album",
          value: a.entity_uid || String(a.id ?? 0),
          label: `${a.name} — ${a.artist}`,
          imageUrl: albumCoverApiUrl(
            {
              albumId: a.id,
              albumEntityUid: a.entity_uid,
              artistEntityUid: a.artist_entity_uid,
              albumSlug: a.slug,
              albumName: a.name,
              artistName: a.artist,
            },
            { size: 128 },
          ),
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
    <div className="radio-page animate-page-in space-y-7 px-4 py-6 sm:px-6">
      <div className="radio-page-hero relative overflow-hidden rounded-[12px] p-5 sm:p-6">
        <div className="radio-page-hero-glow pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="radio-page-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-xl">
              <RadioIcon size={24} />
            </div>
            <div className="min-w-0">
              <h1 className="text-text-primary text-3xl font-bold leading-tight">
                {t("radio.title")}
              </h1>
              <p className="radio-page-intro mt-1 max-w-2xl text-sm leading-relaxed">
                {t("radio.intro")}
              </p>
            </div>
          </div>

          <button
            onClick={startDiscovery}
            disabled={starting || !discoveryAvailable}
            className={cn(
              "radio-discovery-button group inline-flex min-h-12 items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold transition duration-300",
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
        <div className="radio-session-status rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="radio-session-dot h-2 w-2 animate-pulse rounded-full" />
            <span className="radio-session-label text-sm font-medium">
              {t("radio.discovery")}
            </span>
            <span className="radio-session-muted text-[11px]">
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
        <div className="radio-error rounded-xl px-4 py-3 text-sm">
          {t("radio.errors.stations")}
        </div>
      ) : null}

      <div className="radio-seed-panel rounded-[12px] p-5">
        <div className="radio-seed-heading mb-4 flex items-center gap-2 text-sm font-semibold">
          <RadioIcon size={16} className="radio-seed-heading-icon" />
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
          className="radio-seed-input h-12 w-full rounded-lg px-4 text-sm"
        />

        {searching && (
          <Loader2 size={14} className="radio-seed-spinner mt-2 animate-spin" />
        )}

        {results.length > 0 && (
          <div className="radio-seed-results mt-2 space-y-0.5 rounded-xl p-1.5">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.value}`}
                onClick={() => void startSeeded(r)}
                disabled={starting}
                className="radio-seed-result flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition"
              >
                {r.imageUrl ? (
                  <CrateImage
                    src={r.imageUrl}
                    alt=""
                    className={`radio-seed-result-image h-9 w-9 flex-shrink-0 object-cover ${
                      r.type === "artist" ? "rounded-full" : "rounded-md"
                    }`}
                  />
                ) : (
                  <div className="radio-seed-result-placeholder flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md">
                    <Music size={16} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="radio-seed-result-type text-[10px]">
                    {t("radio.seed.resultType", { type: r.type })}
                  </div>
                </div>
                <RadioIcon
                  size={14}
                  className="radio-seed-result-icon flex-shrink-0"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active session info */}
      {activeSession && activeMode !== "discovery" && (
        <div className="radio-session-status rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="radio-session-dot h-2 w-2 animate-pulse rounded-full" />
            <span className="radio-session-label text-sm font-medium">
              {seedLabel} Radio
            </span>
            <span className="radio-session-muted text-[11px]">
              {t("common.playing")}
            </span>
          </div>
          <div className="radio-session-muted mt-1.5 flex items-center gap-1 text-[11px]">
            <ThumbsUp size={10} /> {t("radio.feedback.likePrefix")}{" "}
            <ThumbsDown size={10} /> {t("radio.feedback.dislikeSuffix")}
          </div>
        </div>
      )}
    </div>
  );
}
