import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  isMobilePlaybackRuntime,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  setPlaybackDeliveryPolicyPreference,
  setInfinitePlaybackPreference,
  setCrossfadeDurationPreference,
  setSmartCrossfadePreference,
  setSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  BarChart3,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "@crate/ui/icons";
import { toast } from "sonner";
import { AccountSection } from "@/components/settings/AccountSection";
import { BandcampSection } from "@/components/settings/BandcampSection";
import { LanguageSection } from "@/components/settings/LanguageSection";
import { ScrobbleSection } from "@/components/settings/ScrobbleSection";
import { SleepTimerSection } from "@/components/settings/SleepTimerSection";
import { ServersSection } from "@/components/settings/ServersSection";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
import { api } from "@/lib/api";
import {
  getEqualizerEnabled,
  setEqualizerEnabled,
} from "@/lib/equalizer-prefs";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  RangeRow,
  Section,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
  } ${units[unitIndex]}`;
}

const PLAYBACK_DELIVERY_OPTIONS: {
  value: PlaybackDeliveryPreference;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    value: "auto",
    labelKey: "settings.playback.delivery.auto",
    descriptionKey: "settings.playback.delivery.autoDescription",
  },
  {
    value: "balanced",
    labelKey: "settings.playback.delivery.balanced",
    descriptionKey: "settings.playback.delivery.balancedDescription",
  },
  {
    value: "original",
    labelKey: "settings.playback.delivery.original",
    descriptionKey: "settings.playback.delivery.originalDescription",
  },
  {
    value: "data_saver",
    labelKey: "settings.playback.delivery.dataSaver",
    descriptionKey: "settings.playback.delivery.dataSaverDescription",
  },
];

export function Settings() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const {
    supported: offlineSupported,
    syncing: offlineSyncing,
    summary: offlineSummary,
    syncAll,
    clearActiveProfile,
  } = useOffline();
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(
    getCrossfadeDurationPreference,
  );
  const [smartCrossfadeEnabled, setSmartCrossfadeEnabled] = useState(
    getSmartCrossfadePreference,
  );
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(
    getInfinitePlaybackPreference,
  );
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] =
    useState(getSmartPlaylistSuggestionsPreference);
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] =
    useState(getSmartPlaylistSuggestionsCadencePreference);
  const [playbackDeliveryPolicy, setPlaybackDeliveryPolicy] = useState(
    getPlaybackDeliveryPolicyPreference,
  );
  const mobilePlaybackRuntime = isMobilePlaybackRuntime();
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const [equalizerEnabled, setEqualizerEnabledState] = useState(() =>
    getEqualizerEnabled(androidNativePlayerEnabled),
  );
  const publicProfilePath = useMemo(() => {
    return user?.username ? `/users/${user.username}` : "/people";
  }, [user?.username]);

  return (
    <div className="space-y-8">
      <div className="settings-header">
        <h1 className="text-3xl font-bold text-text-primary">
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{t("settings.subtitle")}</p>
      </div>

      <LanguageSection i18n={i18n} />

      <Section
        title={t("settings.playback.title")}
        description={t("settings.playback.subtitle")}
      >
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t("settings.playback.streamQuality")}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {t("settings.playback.streamQualityDescription")}
            </p>
          </div>
          <div
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
            role="radiogroup"
            aria-label={t("settings.playback.streamQuality")}
          >
            {PLAYBACK_DELIVERY_OPTIONS.map((option) => {
              const selected = playbackDeliveryPolicy === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setPlaybackDeliveryPolicy(option.value);
                    setPlaybackDeliveryPolicyPreference(option.value);
                  }}
                  className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                    selected
                      ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
                      : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
                  }`}
                >
                  <span className="block text-sm font-semibold">
                    {t(option.labelKey)}
                  </span>
                  <span className="mt-1 block text-xs text-text-muted">
                    {t(option.descriptionKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <ToggleRow
          label={t("settings.playback.infinitePlayback")}
          description={t("settings.playback.infinitePlaybackDescription")}
          checked={infinitePlaybackEnabled}
          onChange={(value) => {
            setInfinitePlaybackEnabled(value);
            setInfinitePlaybackPreference(value);
          }}
        />
        {!mobilePlaybackRuntime ? (
          <>
            <ToggleRow
              label={t("settings.playback.smartTransitions")}
              description={t("settings.playback.smartTransitionsDescription")}
              checked={smartCrossfadeEnabled}
              onChange={(value) => {
                setSmartCrossfadeEnabled(value);
                setSmartCrossfadePreference(value);
              }}
            />
            <RangeRow
              label={t("settings.playback.crossfade")}
              description={t("settings.playback.crossfadeDescription")}
              value={crossfadeSeconds}
              min={0}
              max={12}
              step={1}
              displayValue={
                crossfadeSeconds === 0
                  ? t("common.off")
                  : t("common.secondsShort", { count: crossfadeSeconds })
              }
              onChange={(value) => {
                setCrossfadeSeconds(value);
                setCrossfadeDurationPreference(value);
              }}
            />
          </>
        ) : null}
        {!mobilePlaybackRuntime || androidNativePlayerEnabled ? (
          <ToggleRow
            label={t("player.equalizer")}
            checked={equalizerEnabled}
            onChange={(value) => {
              setEqualizerEnabledState(value);
              setEqualizerEnabled(value);
            }}
          />
        ) : null}
        <ToggleRow
          label={t("settings.playback.smartPlaylistSuggestions")}
          description={t(
            "settings.playback.smartPlaylistSuggestionsDescription",
          )}
          checked={smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsEnabled(value);
            setSmartPlaylistSuggestionsPreference(value);
          }}
        />
        <RangeRow
          label={t("settings.playback.suggestionCadence")}
          description={t("settings.playback.suggestionCadenceDescription")}
          value={smartPlaylistSuggestionsCadence}
          min={2}
          max={10}
          step={1}
          displayValue={t("settings.playback.suggestionCadenceValue", {
            count: smartPlaylistSuggestionsCadence,
          })}
          disabled={!smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsCadence(value);
            setSmartPlaylistSuggestionsCadencePreference(value);
          }}
        />
      </Section>

      <Section
        title={t("settings.offline.title")}
        description={t("settings.offline.subtitle")}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-primary/40">
              {t("settings.offline.items")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">
              {offlineSummary.itemCount}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t("settings.offline.readyItems", {
                count: offlineSummary.readyItemCount,
              })}
              {offlineSummary.errorItemCount
                ? ` · ${t("settings.offline.needsAttention", {
                    count: offlineSummary.errorItemCount,
                  })}`
                : ""}
            </p>
          </div>
          <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-primary/40">
              {t("common.tracks")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">
              {offlineSummary.readyTrackCount}/{offlineSummary.trackCount}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t("settings.offline.mirrored")}
            </p>
          </div>
          <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-primary/40">
              {t("settings.offline.storage")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">
              {formatBytes(offlineSummary.totalBytes)}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {t("settings.offline.footprint")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={
              !offlineSupported ||
              offlineSyncing ||
              offlineSummary.itemCount === 0
            }
            onClick={() => {
              void syncAll()
                .then(() => {
                  toast.success(t("settings.offline.toasts.synced"));
                })
                .catch((error) => {
                  toast.error(
                    (error as Error).message ||
                      t("settings.offline.toasts.syncFailed"),
                  );
                });
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-action/30 bg-accent-action/10 px-4 py-2 text-sm font-medium text-accent-action transition-colors hover:bg-accent-action/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {offlineSyncing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {t("settings.offline.syncNow")}
          </button>
          <button
            type="button"
            disabled={
              !offlineSupported ||
              offlineSyncing ||
              offlineSummary.itemCount === 0
            }
            onClick={() => {
              void clearActiveProfile()
                .then(() => {
                  toast.success(t("settings.offline.toasts.removed"));
                })
                .catch((error) => {
                  toast.error(
                    (error as Error).message ||
                      t("settings.offline.toasts.clearFailed"),
                  );
                });
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-state-danger/25 bg-state-danger/10 px-4 py-2 text-sm font-medium text-state-danger transition-colors hover:bg-state-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
            {t("settings.offline.removeCopies")}
          </button>
        </div>

        <div className="rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
          <div className="flex items-start gap-3">
            <ArrowDownToLine
              size={16}
              className="mt-0.5 text-text-primary/50"
            />
            <div>
              {offlineSupported
                ? t("settings.offline.localMirrorDescription")
                : t("settings.offline.unavailable")}
            </div>
          </div>
        </div>
      </Section>

      <ServersSection />

      <ShowsLocationSection />

      <SleepTimerSection />

      <AccountSection />

      <ScrobbleSection />

      <BandcampSection />

      <Section title={t("settings.links.title")}>
        <div className="flex flex-col gap-2">
          <Link
            to={publicProfilePath}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-text-primary hover:bg-text-primary/5 transition-colors"
          >
            <Users size={18} className="text-text-muted" />{" "}
            {t("settings.links.profile")}
          </Link>
          <Link
            to="/people"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-text-primary hover:bg-text-primary/5 transition-colors"
          >
            <Users size={18} className="text-text-muted" />{" "}
            {t("settings.links.people")}
          </Link>
          <Link
            to="/upload"
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-text-primary hover:bg-text-primary/5 transition-colors"
          >
            <Upload size={18} className="text-text-muted" /> {t("upload.badge")}
          </Link>
          <Link
            to="/stats"
            className="hidden items-center gap-3 rounded-xl px-3 py-3 text-sm text-text-primary transition-colors hover:bg-text-primary/5 md:flex"
          >
            <BarChart3 size={18} className="text-text-muted" />{" "}
            {t("settings.links.stats")}
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-state-danger hover:bg-text-primary/5 transition-colors w-full text-left"
          >
            <LogOut size={18} /> {t("auth.logout")}
          </button>
        </div>
      </Section>
    </div>
  );
}

const RADIUS_OPTIONS = [20, 40, 60, 100, 150, 200];

interface LocationData {
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  show_radius_km: number;
  show_location_mode: string;
}

interface CityResult {
  city: string;
  country: string;
  country_code: string;
  display_name: string;
  latitude: number;
  longitude: number;
}

function ShowsLocationSection() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [mode, setMode] = useState<"fixed" | "near_me">("fixed");
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    api<LocationData>("/api/me/location")
      .then((data) => {
        setLocation(data);
        setMode((data.show_location_mode as "fixed" | "near_me") || "fixed");
        setCity(data.city || "");
        setRadius(data.show_radius_km || 60);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (location && !location.city) detectFromIp(true);
  }, [location?.city]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<CityResult[]>(
        `/api/me/cities/search?q=${encodeURIComponent(searchQuery)}`,
      )
        .then((results) => {
          setSearchResults(results);
          setShowDropdown(true);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function detectFromIp(silent = false) {
    setDetecting(true);
    try {
      const geo = await api<{
        city: string;
        country: string;
        country_code: string;
        latitude: number;
        longitude: number;
      }>("/api/me/geolocation");
      setCity(geo.city);
      await api("/api/me/location", "PUT", {
        city: geo.city,
        country: geo.country,
        country_code: geo.country_code,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
      setLocation((prev) => (prev ? { ...prev, ...geo } : null));
      if (!silent) {
        toast.success(
          t("settings.shows.toasts.detected", {
            city: geo.city,
            country: geo.country,
          }),
        );
      }
    } catch {
      if (!silent) toast.error(t("settings.shows.toasts.detectFailed"));
    } finally {
      setDetecting(false);
    }
  }

  function selectCity(result: CityResult) {
    setCity(result.city);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    api("/api/me/location", "PUT", {
      city: result.city,
      country: result.country,
      country_code: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
    })
      .then(() => {
        setLocation((prev) =>
          prev
            ? {
                ...prev,
                city: result.city,
                country: result.country,
                country_code: result.country_code,
                latitude: result.latitude,
                longitude: result.longitude,
              }
            : null,
        );
        toast.success(
          t("settings.shows.toasts.citySet", { city: result.display_name }),
        );
      })
      .catch(() => toast.error(t("settings.shows.toasts.saveCityFailed")));
  }

  async function saveMode(newMode: "fixed" | "near_me") {
    setMode(newMode);
    try {
      await api("/api/me/location", "PUT", { show_location_mode: newMode });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  async function saveRadius(newRadius: number) {
    setRadius(newRadius);
    try {
      await api("/api/me/location", "PUT", { show_radius_km: newRadius });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  const displayCity = city || location?.city;
  const displayCountry = location?.country;

  return (
    <Section
      title={t("settings.shows.title")}
      description={t("settings.shows.description")}
    >
      <div className="space-y-3">
        <div className="text-sm font-medium text-text-primary">
          {t("settings.shows.location")}
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => saveMode("fixed")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === "fixed"
                ? "border-accent-action/30 bg-accent-action/8"
                : "border-border-quiet/10 bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
            }`}
          >
            <MapPin
              size={16}
              className={
                mode === "fixed" ? "text-accent-action" : "text-text-primary/40"
              }
            />
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  mode === "fixed" ? "text-accent-action" : "text-text-primary"
                }`}
              >
                {t("settings.shows.fixedCity")}
              </div>
              <div className="text-xs text-text-muted">
                {displayCity
                  ? `${displayCity}${
                      displayCountry ? `, ${displayCountry}` : ""
                    }`
                  : t("settings.shows.notSet")}
              </div>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                mode === "fixed"
                  ? "border-accent-action bg-accent-action"
                  : "border-border-quiet/20"
              }`}
            >
              {mode === "fixed" && (
                <div className="h-full w-full rounded-full bg-text-primary scale-[0.4]" />
              )}
            </div>
          </button>
          <button
            onClick={() => saveMode("near_me")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === "near_me"
                ? "border-accent-action/30 bg-accent-action/8"
                : "border-border-quiet/10 bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
            }`}
          >
            <Navigation
              size={16}
              className={
                mode === "near_me"
                  ? "text-accent-action"
                  : "text-text-primary/40"
              }
            />
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  mode === "near_me"
                    ? "text-accent-action"
                    : "text-text-primary"
                }`}
              >
                {t("settings.shows.nearMe")}
              </div>
              <div className="text-xs text-text-muted">
                {t("settings.shows.nearMeDescription")}
              </div>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                mode === "near_me"
                  ? "border-accent-action bg-accent-action"
                  : "border-border-quiet/20"
              }`}
            >
              {mode === "near_me" && (
                <div className="h-full w-full rounded-full bg-text-primary scale-[0.4]" />
              )}
            </div>
          </button>
        </div>
      </div>

      {mode === "fixed" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-text-muted">
              {t("settings.shows.city")}
            </label>
            <button
              onClick={() => detectFromIp()}
              disabled={detecting}
              className="flex items-center gap-1 text-[11px] text-accent-action hover:underline disabled:opacity-50"
            >
              {detecting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Navigation size={10} />
              )}
              {t("settings.shows.detectFromIp")}
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              value={searchQuery || city}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value) setCity("");
              }}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              placeholder={t("settings.shows.cityPlaceholder")}
              className="w-full h-10 px-3 rounded-lg bg-text-primary/5 border border-border-quiet/10 text-sm text-text-primary outline-none focus:border-accent-action/40 placeholder:text-text-primary/40"
            />
            {searching && (
              <Loader2
                size={14}
                className="absolute right-3 top-3 animate-spin text-text-primary/40"
              />
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-app-dropdown mt-1 overflow-hidden rounded-xl border border-border-quiet/10 bg-surface-overlay shadow-xl">
                {searchResults.map((result) => (
                  <button
                    key={`${result.latitude}-${result.longitude}`}
                    onMouseDown={() => selectCity(result)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-text-primary/5 transition-colors"
                  >
                    <MapPin
                      size={12}
                      className="flex-shrink-0 text-accent-action/60"
                    />
                    <span>{result.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-text-primary">
            {t("settings.shows.searchRadius")}
          </div>
          <div className="rounded-full border border-border-quiet/10 bg-text-primary/[0.03] px-2.5 py-1 text-xs text-text-primary/70">
            {radius} km
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => saveRadius(r)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                radius === r
                  ? "bg-accent-action text-accent-action-foreground"
                  : "bg-text-primary/5 text-text-muted hover:bg-text-primary/10"
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}
