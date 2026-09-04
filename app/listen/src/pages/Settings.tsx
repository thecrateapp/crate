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
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  BarChart3,
  Loader2,
  LogOut,
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
import { ShowsLocationSection } from "@/components/settings/ShowsLocationSection";
import { SleepTimerSection } from "@/components/settings/SleepTimerSection";
import { ServersSection } from "@/components/settings/ServersSection";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
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
