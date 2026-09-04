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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  BarChart3,
  Globe,
  Loader2,
  LogOut,
  Lock,
  MapPin,
  Moon,
  Navigation,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
  Upload,
  Users,
} from "@crate/ui/icons";
import { toast } from "sonner";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { CrateImage } from "@/components/artwork/CrateImage";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  clearLocalListenLocalePreference,
  getLocalListenLocalePreference,
  setLocalListenLocalePreference,
} from "@/i18n/language-preference";
import { detectPreferredLocale } from "@/i18n/language-detector";
import {
  LISTEN_SUPPORTED_LOCALES,
  type ListenLocale,
  toSupportedListenLocale,
} from "@/i18n/locales";
import { ServersSection } from "@/components/settings/ServersSection";
import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";
import { api } from "@/lib/api";
import { isTauriRuntime } from "@/lib/platform";
import {
  subscribeSleepTimer,
  startSleepTimer,
  cancelSleepTimer,
  formatRemaining,
  type SleepTimerMode,
  type SleepTimerState,
} from "@/lib/sleep-timer";
import {
  getEqualizerEnabled,
  setEqualizerEnabled,
} from "@/lib/equalizer-prefs";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";

interface AuthProviderState {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

interface AuthPublicConfig {
  invite_only?: boolean;
}

interface BandcampStatus {
  connected: boolean;
  status: string;
  bridge_enabled: boolean;
  bridge_ready?: boolean;
  bridge_backend?: string | null;
  bridge_message?: string | null;
  username?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
}

interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

interface BandcampTaskDetail {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  error?: string | null;
  result?: {
    synced?: number;
    imports_queued?: number;
    imports_skipped_existing?: number;
    counts?: Record<string, number>;
    matches_created?: number;
    radar_upserted?: number;
  } | null;
}

interface BandcampCookieEventPayload {
  cookie?: string;
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section rounded-[12px] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`space-y-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-text-primary">{label}</div>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <div className="rounded-full border border-border-quiet/10 bg-text-primary/[0.03] px-2.5 py-1 text-xs text-text-primary/70">
          {displayValue ?? value}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="settings-range w-full disabled:cursor-not-allowed"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={label}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-accent-action/50 bg-accent-action/25"
            : "border-border-quiet/10 bg-text-primary/[0.03]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-text-primary shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
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

type LanguageSelection = "auto" | ListenLocale;

const LANGUAGE_OPTIONS: { value: ListenLocale; labelKey: string }[] =
  LISTEN_SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    labelKey: `settings.language.options.${locale}`,
  }));

function getBrowserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages;
}

function getAutomaticListenLocale(): ListenLocale {
  return detectPreferredLocale({
    browserLanguages: getBrowserLanguages(),
  });
}

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

function LanguageSection({
  i18n,
}: {
  i18n: ReturnType<typeof useTranslation>["i18n"];
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<LanguageSelection>(
    () => getLocalListenLocalePreference() ?? "auto",
  );
  const activeLocale =
    selection === "auto"
      ? toSupportedListenLocale(i18n.resolvedLanguage) ??
        getAutomaticListenLocale()
      : selection;

  const changeLanguage = (nextSelection: LanguageSelection) => {
    setSelection(nextSelection);
    const nextLocale =
      nextSelection === "auto" ? getAutomaticListenLocale() : nextSelection;

    if (nextSelection === "auto") {
      clearLocalListenLocalePreference();
    } else {
      setLocalListenLocalePreference(nextSelection);
    }

    void i18n.changeLanguage(nextLocale);
  };

  return (
    <Section
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <div
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        role="radiogroup"
        aria-label={t("settings.language.title")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selection === "auto"}
          onClick={() => changeLanguage("auto")}
          className={`rounded-lg border px-3 py-3 text-left transition-colors ${
            selection === "auto"
              ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
              : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
          }`}
        >
          <span className="block text-sm font-semibold">
            {t("settings.language.auto")}
          </span>
          <span className="mt-1 block text-xs text-text-muted">
            {t("settings.language.autoDescription")}
          </span>
        </button>

        {LANGUAGE_OPTIONS.map((option) => {
          const selected = selection === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => changeLanguage(option.value)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                selected
                  ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
                  : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
              }`}
            >
              <span className="block text-sm font-semibold">
                {t(option.labelKey)}
              </span>
              <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-text-muted">
                {option.value}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
        <Globe size={16} className="mt-0.5 text-accent-action/80" />
        <span>
          {t("settings.language.current", {
            language: t(`settings.language.options.${activeLocale}`),
          })}
        </span>
      </div>
    </Section>
  );
}

const SLEEP_MODES: { mode: SleepTimerMode; labelKey: string }[] = [
  { mode: "15min", labelKey: "settings.sleep.modes.15min" },
  { mode: "30min", labelKey: "settings.sleep.modes.30min" },
  { mode: "45min", labelKey: "settings.sleep.modes.45min" },
  { mode: "1hr", labelKey: "settings.sleep.modes.1hr" },
  { mode: "end_of_track", labelKey: "settings.sleep.modes.endOfTrack" },
];

function SleepTimerSection() {
  const { t } = useTranslation();
  const { pause } = usePlayerActions();
  const [timer, setTimer] = useState<SleepTimerState>({
    active: false,
    remainingSeconds: 0,
    mode: null,
  });
  useEffect(() => subscribeSleepTimer(setTimer), []);

  return (
    <Section
      title={t("settings.sleep.title")}
      description={t("settings.sleep.subtitle")}
    >
      <div className="flex flex-wrap gap-2">
        {SLEEP_MODES.map(({ mode, labelKey }) => (
          <button
            key={mode}
            onClick={() => startSleepTimer(mode, pause)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              timer.mode === mode
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-primary/60 hover:bg-text-primary/10"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {timer.active && timer.remainingSeconds > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-accent-action/20 bg-accent-action/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon size={16} className="text-accent-action" />
            <span className="text-sm text-text-primary">
              {t("settings.sleep.pausingIn")}{" "}
              <span className="font-mono font-semibold text-accent-action">
                {formatRemaining(timer.remainingSeconds)}
              </span>
            </span>
          </div>
          <button
            onClick={cancelSleepTimer}
            className="rounded-full px-3 py-1.5 text-xs font-medium bg-state-danger/15 text-state-danger hover:bg-state-danger/25 transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function BandcampSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BandcampStatus | null>(null);
  const [counts, setCounts] = useState({
    collection: 0,
    wishlist: 0,
    following: 0,
  });
  const [bandcampCookie, setBandcampCookie] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadBandcamp = useCallback(async () => {
    const nextStatus = await api<BandcampStatus>("/api/bandcamp/me/status");
    setStatus(nextStatus);
    if (!nextStatus.connected) {
      setCounts({ collection: 0, wishlist: 0, following: 0 });
      return;
    }
    const [collection, wishlist, following] = await Promise.all([
      api<{ total: number }>("/api/bandcamp/me/collection").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/wishlist").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/following").catch(() => ({
        total: 0,
      })),
    ]);
    setCounts({
      collection: collection.total || 0,
      wishlist: wishlist.total || 0,
      following: following.total || 0,
    });
  }, []);

  const connectWithCookie = useCallback(
    async (
      cookie: string,
      connectionMethod: "manual_cookie" | "native_desktop" = "manual_cookie",
    ) => {
      const trimmedCookie = cookie.trim();
      if (!trimmedCookie) {
        toast.error(t("settings.bandcamp.toasts.cookieRequired"));
        return;
      }
      setBusy(
        connectionMethod === "native_desktop"
          ? "tauri-connect"
          : "cookie-connect",
      );
      try {
        await api<BandcampStatus>("/api/bandcamp/me/connect/cookie", "POST", {
          cookie: trimmedCookie,
          connection_method: connectionMethod,
        });
        toast.success(t("settings.bandcamp.toasts.connected"));
        setBandcampCookie("");
        await loadBandcamp();
      } catch (error) {
        toast.error(
          (error as Error).message ||
            t("settings.bandcamp.toasts.connectFailed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [loadBandcamp],
  );

  useEffect(() => {
    loadBandcamp().catch(() => {});
  }, [loadBandcamp]);

  useEffect(() => {
    if (!isTauriRuntime) return;

    const handleBandcampCookie = (event: Event) => {
      const payload = (event as CustomEvent<BandcampCookieEventPayload>).detail;
      if (!payload?.cookie) return;
      void connectWithCookie(payload.cookie, "native_desktop");
    };

    window.addEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    return () => {
      window.removeEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    };
  }, [connectWithCookie]);

  const openTauriBandcampInterceptor = async () => {
    if (!window.__crateTauriInvoke) {
      toast.error(t("settings.bandcamp.toasts.desktopUnavailable"));
      return;
    }
    setBusy("tauri-connect");
    try {
      await window.__crateTauriInvoke("open_bandcamp_cookie_interceptor");
      toast.info(t("settings.bandcamp.toasts.finishLogin"));
      window.setTimeout(
        () => {
          setBusy((current) => (current === "tauri-connect" ? null : current));
        },
        5 * 60 * 1000,
      );
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.openLoginFailed"),
      );
      setBusy(null);
    }
  };

  const syncBandcamp = async () => {
    setBusy("sync");
    try {
      const result = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/sync",
        "POST",
      );
      toast.success(t("settings.bandcamp.toasts.syncStarted"));
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await delay(1500);
        const task = await api<BandcampTaskDetail>(
          `/api/tasks/${encodeURIComponent(result.task_id)}`,
        );
        if (task.status === "completed") {
          await loadBandcamp();
          const synced = task.result?.synced;
          const importsQueued = task.result?.imports_queued ?? 0;
          const skippedExisting = task.result?.imports_skipped_existing ?? 0;
          const suffix = [
            synced != null
              ? t("settings.bandcamp.syncSummary.synced", { count: synced })
              : null,
            importsQueued
              ? t("settings.bandcamp.syncSummary.importsQueued", {
                  count: importsQueued,
                })
              : null,
            skippedExisting
              ? t("settings.bandcamp.syncSummary.alreadyInCrate", {
                  count: skippedExisting,
                })
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          toast.success(
            suffix
              ? t("settings.bandcamp.toasts.syncCompleteWithSummary", {
                  summary: suffix,
                })
              : t("settings.bandcamp.toasts.syncComplete"),
          );
          return;
        }
        if (task.status === "failed" || task.status === "cancelled") {
          toast.error(task.error || t("settings.bandcamp.toasts.syncFailed"));
          return;
        }
      }
      toast.info(t("settings.bandcamp.toasts.syncBackground"));
    } catch (error) {
      toast.error(
        (error as Error).message || t("settings.bandcamp.toasts.syncFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnectBandcamp = async () => {
    setBusy("disconnect");
    try {
      await api("/api/bandcamp/me/disconnect", "POST");
      toast.success(t("settings.bandcamp.toasts.disconnected"));
      await loadBandcamp();
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.disconnectFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const connectedName =
    status?.display_name ||
    status?.username ||
    t("bandcamp.connection.accountFallback");

  return (
    <Section title="Bandcamp" description={t("settings.bandcamp.description")}>
      <div className="settings-bandcamp-connected rounded-xl p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {status?.image_url ? (
              <CrateImage
                src={status.image_url}
                retryPolicy="none"
                alt=""
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-text-primary/10 text-accent-action">
                <BandcampLogo size={20} />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">
                {status?.connected ? connectedName : t("common.notConnected")}
              </p>
              <p className="text-xs text-text-muted">
                {status?.connected
                  ? t("settings.bandcamp.summary", {
                      collection: counts.collection,
                      wishlist: counts.wishlist,
                      following: counts.following,
                    })
                  : isTauriRuntime
                    ? t("settings.bandcamp.connectDesktopHint")
                    : t("settings.bandcamp.connectCookieHint")}
              </p>
            </div>
          </div>
          {status?.connected ? (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/library?tab=bandcamp"
                className="inline-flex items-center gap-2 rounded-full border border-border-quiet/10 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-text-primary/10"
              >
                <BandcampLogo size={14} />
                {t("settings.bandcamp.viewPurchases")}
              </Link>
              <button
                onClick={syncBandcamp}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-xs font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
              >
                {busy === "sync" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t("bandcamp.actions.sync")}
              </button>
              <button
                onClick={disconnectBandcamp}
                disabled={busy !== null}
                className="rounded-full border border-state-danger/25 px-4 py-2 text-xs font-semibold text-state-danger transition-colors hover:bg-state-danger/10 disabled:opacity-50"
              >
                {t("common.disconnect")}
              </button>
            </div>
          ) : null}
        </div>
        {status?.last_error ? (
          <p className="mt-3 text-xs text-state-danger">{status.last_error}</p>
        ) : null}
      </div>

      {!status?.connected ? (
        <div className="space-y-4 rounded-xl border border-state-warning/20 bg-state-warning/5 p-4">
          {isTauriRuntime ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
                <Smartphone
                  size={16}
                  className="mt-0.5 shrink-0 text-state-warning"
                />
                <p>{t("settings.bandcamp.desktopConnectorDescription")}</p>
              </div>
              <button
                onClick={openTauriBandcampInterceptor}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-xs font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
              >
                {busy === "tauri-connect" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <BandcampLogo size={14} />
                )}
                {t("settings.bandcamp.connectWindow")}
              </button>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
              <Lock size={16} className="mt-0.5 shrink-0 text-state-warning" />
              <p>
                {t("settings.bandcamp.cookieInstructionsPrefix")}{" "}
                <span className="font-mono text-state-warning">identity</span>{" "}
                {t("settings.bandcamp.cookieInstructionsFrom")}{" "}
                <span className="font-mono text-state-warning">
                  bandcamp.com
                </span>
                .{t("settings.bandcamp.cookieInstructionsSuffix")}{" "}
                <span className="font-mono text-state-warning">Cookie</span>{" "}
                {t("settings.bandcamp.cookieInstructionsHeader")}{" "}
                {t("settings.bandcamp.cookieInstructionsEnd")}
              </p>
            </div>
            <textarea
              value={bandcampCookie}
              onChange={(event) => setBandcampCookie(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={t("settings.bandcamp.cookiePlaceholder")}
              className="w-full resize-none rounded-lg border border-border-quiet/10 bg-surface-canvas/30 px-3 py-2 font-mono text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/50"
            />
            <button
              onClick={() => void connectWithCookie(bandcampCookie)}
              disabled={busy !== null || !bandcampCookie.trim()}
              className="inline-flex items-center gap-2 rounded-full border border-border-quiet/10 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-text-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "cookie-connect" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <BandcampLogo size={14} />
              )}
              {t("settings.bandcamp.connectWithCookie")}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function ScrobbleSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<
    Record<string, { connected: boolean; username?: string }>
  >({});
  const [lbToken, setLbToken] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [remoteScrobblingEnabled, setRemoteScrobblingEnabled] = useState(false);
  const [savingRemotePreference, setSavingRemotePreference] = useState(false);

  useEffect(() => {
    void Promise.allSettled([
      api<Record<string, { connected: boolean; username?: string }>>(
        "/api/me/scrobble/status",
      ).then(setStatus),
      api<{ remote_scrobbling_enabled: boolean }>(
        "/api/me/scrobble/preferences",
      ).then((preference) =>
        setRemoteScrobblingEnabled(preference.remote_scrobbling_enabled),
      ),
    ]);
  }, []);

  const updateRemoteScrobbling = async (enabled: boolean) => {
    const previous = remoteScrobblingEnabled;
    setRemoteScrobblingEnabled(enabled);
    setSavingRemotePreference(true);
    try {
      const preference = await api<{ remote_scrobbling_enabled: boolean }>(
        "/api/me/scrobble/preferences",
        "PUT",
        { remote_scrobbling_enabled: enabled },
      );
      setRemoteScrobblingEnabled(preference.remote_scrobbling_enabled);
    } catch {
      setRemoteScrobblingEnabled(previous);
      toast.error(t("settings.scrobbling.toasts.preferenceFailed"));
    } finally {
      setSavingRemotePreference(false);
    }
  };

  const handleLastfmConnect = async () => {
    setConnecting("lastfm");
    try {
      const { api_key } = await api<{ api_key: string }>(
        "/api/me/scrobble/lastfm/auth-url",
      );
      const cb = encodeURIComponent(
        `${window.location.origin}/settings?lastfm=callback`,
      );
      window.location.href = `https://www.last.fm/api/auth/?api_key=${api_key}&cb=${cb}`;
    } catch {
      toast.error(t("settings.scrobbling.toasts.lastfmNotConfigured"));
      setConnecting(null);
    }
  };

  const handleLastfmCallback = async (token: string) => {
    setConnecting("lastfm");
    try {
      await api("/api/me/scrobble/lastfm", "POST", { token });
      toast.success(t("settings.scrobbling.toasts.lastfmConnected"));
      const updated = await api<
        Record<string, { connected: boolean; username?: string }>
      >("/api/me/scrobble/status");
      setStatus(updated);
    } catch {
      toast.error(t("settings.scrobbling.toasts.lastfmConnectFailed"));
    } finally {
      setConnecting(null);
    }
  };

  const handleListenBrainzConnect = async () => {
    if (!lbToken.trim()) return;
    setConnecting("listenbrainz");
    try {
      const result = await api<{ ok: boolean; username: string }>(
        "/api/me/scrobble/listenbrainz",
        "POST",
        { token: lbToken.trim() },
      );
      toast.success(
        t("settings.scrobbling.toasts.listenbrainzConnected", {
          username: result.username,
        }),
      );
      setLbToken("");
      const updated = await api<
        Record<string, { connected: boolean; username?: string }>
      >("/api/me/scrobble/status");
      setStatus(updated);
    } catch {
      toast.error(t("settings.scrobbling.toasts.invalidListenbrainzToken"));
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    try {
      await api(`/api/me/scrobble/${provider}`, "DELETE");
      setStatus((prev) => ({ ...prev, [provider]: { connected: false } }));
      toast.success(
        t("settings.scrobbling.toasts.disconnected", {
          provider: provider === "lastfm" ? "Last.fm" : "ListenBrainz",
        }),
      );
    } catch {
      toast.error(t("common.toasts.disconnectFailed"));
    }
  };

  // Handle Last.fm callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lastfmToken = params.get("token");
    if (params.get("lastfm") === "callback" && lastfmToken) {
      window.history.replaceState({}, "", "/settings");
      handleLastfmCallback(lastfmToken);
    }
  }, []);

  const lastfm = status.lastfm;
  const listenbrainz = status.listenbrainz;

  return (
    <Section
      title={t("settings.scrobbling.title")}
      description={t("settings.scrobbling.description")}
    >
      <div className={savingRemotePreference ? "opacity-70" : undefined}>
        <ToggleRow
          label={t("settings.scrobbling.remotePlays")}
          description={t("settings.scrobbling.remotePlaysDescription")}
          checked={remoteScrobblingEnabled}
          onChange={(enabled) => void updateRemoteScrobbling(enabled)}
        />
      </div>

      {/* Last.fm */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Last.fm</p>
          {lastfm?.connected ? (
            <p className="text-xs text-state-success">
              {lastfm.username
                ? t("settings.scrobbling.connectedAs", {
                    username: lastfm.username,
                  })
                : t("common.connected")}
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              {t("common.notConnected")}
            </p>
          )}
        </div>
        {lastfm?.connected ? (
          <button
            onClick={() => handleDisconnect("lastfm")}
            className="rounded-full px-4 py-2 text-xs font-medium bg-state-danger/15 text-state-danger hover:bg-state-danger/25 transition-colors"
          >
            {t("common.disconnect")}
          </button>
        ) : (
          <button
            onClick={handleLastfmConnect}
            disabled={connecting === "lastfm"}
            className="rounded-full px-4 py-2 text-xs font-medium bg-accent-action/15 text-accent-action hover:bg-accent-action/25 transition-colors disabled:opacity-50"
          >
            {connecting === "lastfm"
              ? t("common.connecting")
              : t("common.connect")}
          </button>
        )}
      </div>

      {/* ListenBrainz */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">ListenBrainz</p>
          {listenbrainz?.connected ? (
            <p className="text-xs text-state-success">
              {listenbrainz.username
                ? t("settings.scrobbling.connectedAs", {
                    username: listenbrainz.username,
                  })
                : t("common.connected")}
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              {t("common.notConnected")}
            </p>
          )}
        </div>
        {listenbrainz?.connected ? (
          <button
            onClick={() => handleDisconnect("listenbrainz")}
            className="rounded-full px-4 py-2 text-xs font-medium bg-state-danger/15 text-state-danger hover:bg-state-danger/25 transition-colors"
          >
            {t("common.disconnect")}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
              placeholder={t("settings.scrobbling.apiToken")}
              className="w-36 rounded-lg bg-text-primary/5 border border-border-quiet/10 px-3 py-1.5 text-xs text-text-primary placeholder:text-text-primary/40 focus:outline-none focus:border-accent-action/50"
              onKeyDown={(e) =>
                e.key === "Enter" && handleListenBrainzConnect()
              }
            />
            <button
              onClick={handleListenBrainzConnect}
              disabled={connecting === "listenbrainz" || !lbToken.trim()}
              className="rounded-full px-4 py-2 text-xs font-medium bg-accent-action/15 text-accent-action hover:bg-accent-action/25 transition-colors disabled:opacity-50"
            >
              {connecting === "listenbrainz" ? "..." : t("common.connect")}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

function AccountSection() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [providers, setProviders] = useState<Record<string, AuthProviderState>>(
    {},
  );
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig>({});
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setBio(user?.bio || "");
  }, [user?.bio, user?.name, user?.username]);

  useEffect(() => {
    api<Record<string, AuthProviderState>>("/api/auth/providers")
      .then(setProviders)
      .catch(() => {});
    api<AuthPublicConfig>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  async function handleSaveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", {
        name: name.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
      });
      toast.success(t("settings.account.toasts.profileUpdated"));
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Username is already taken")) {
        toast.error(t("settings.account.toasts.usernameTaken"));
      } else {
        toast.error(t("settings.account.toasts.profileUpdateFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      toast.error(t("settings.account.toasts.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.account.toasts.passwordMismatch"));
      return;
    }
    setSaving(true);
    try {
      await api("/api/me/password", "PUT", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success(t("settings.account.toasts.passwordChanged"));
      setShowPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error(t("settings.account.toasts.passwordChangeFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkProvider(provider: string) {
    setLinkingProvider(provider);
    try {
      const response = await api<{ login_url: string }>(
        `/api/auth/oauth/${provider}/link`,
        "POST",
        {
          return_to: `${window.location.origin}/settings`,
        },
      );
      window.location.href = response.login_url;
    } catch {
      toast.error(t("settings.account.toasts.linkFailed", { provider }));
      setLinkingProvider(null);
    }
  }

  async function handleUnlinkProvider(provider: string) {
    setUnlinkingProvider(provider);
    try {
      await api(`/api/auth/oauth/${provider}/unlink`, "POST");
      toast.success(t("settings.account.toasts.unlinked", { provider }));
      await refetch();
    } catch {
      toast.error(t("settings.account.toasts.unlinkFailed", { provider }));
    } finally {
      setUnlinkingProvider(null);
    }
  }

  const connectedAccounts = user?.connected_accounts || [];
  const linkedProviders = new Set(
    connectedAccounts
      .filter((item) => item.status !== "unlinked")
      .map((item) => item.provider),
  );
  const socialProviders = Object.entries(providers).filter(
    ([provider, state]) =>
      provider !== "password" && state.configured && state.enabled,
  );

  return (
    <Section
      title={t("settings.account.title")}
      description={t("settings.account.description")}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-text-muted">
            {t("settings.account.displayName")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 h-10 px-3 rounded-lg bg-text-primary/5 text-sm text-text-primary outline-none focus:bg-text-primary/8"
              placeholder={t("auth.register.namePlaceholder")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-text-muted">
            {t("settings.account.username")}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "-"))}
            className="w-full h-10 px-3 rounded-lg bg-text-primary/5 text-sm text-text-primary outline-none focus:bg-text-primary/8"
            placeholder={t("settings.account.usernamePlaceholder")}
          />
          <p className="text-xs text-text-muted">
            {t("settings.account.usernameDescription")}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-text-muted">
            {t("settings.account.bio")}
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="min-h-24 w-full rounded-lg bg-text-primary/5 px-3 py-3 text-sm text-text-primary outline-none focus:bg-text-primary/8"
            placeholder={t("settings.account.bioPlaceholder")}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSaveName}
            disabled={
              saving ||
              (name.trim() === (user?.name || "") &&
                username.trim() === (user?.username || "") &&
                bio.trim() === (user?.bio || ""))
            }
            className="h-10 px-4 rounded-lg bg-accent-action text-sm font-medium text-accent-action-foreground disabled:opacity-40 transition-opacity"
          >
            {saving ? t("common.saving") : t("settings.account.saveProfile")}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-text-muted">{t("common.email")}</label>
          <p className="text-sm text-text-primary/60 px-1">
            {user?.email || "—"}
          </p>
        </div>

        {socialProviders.length > 0 ? (
          <div className="space-y-3 rounded-xl bg-text-primary/5 p-4">
            <div>
              <div className="text-sm font-medium text-text-primary">
                {t("settings.account.connectedAccounts")}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {t("settings.account.connectedAccountsDescription")}
              </p>
            </div>
            {socialProviders.map(([provider]) => {
              const linked = linkedProviders.has(provider);
              const busy =
                linkingProvider === provider || unlinkingProvider === provider;
              return (
                <div
                  key={provider}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border-quiet/10 px-3 py-3"
                >
                  <div>
                    <div className="text-sm font-medium text-text-primary capitalize">
                      {provider}
                    </div>
                    <div className="text-xs text-text-muted">
                      {linked
                        ? t("settings.account.linked")
                        : t("settings.account.notLinked")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      linked
                        ? void handleUnlinkProvider(provider)
                        : void handleLinkProvider(provider)
                    }
                    className="rounded-lg border border-border-quiet/15 bg-text-primary/5 px-3 py-2 text-xs font-medium text-text-primary hover:bg-text-primary/10 transition-colors disabled:opacity-50"
                  >
                    {busy
                      ? t("common.working")
                      : linked
                        ? t("settings.account.unlink")
                        : t("settings.account.link")}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <ConnectDevicesSection />

        {authConfig.invite_only ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent-action/20 bg-accent-action/10 px-4 py-3 text-sm text-accent-action">
            <Shield size={16} className="mt-0.5 flex-shrink-0" />
            <div>{t("settings.account.inviteOnlyNotice")}</div>
          </div>
        ) : null}

        {!showPassword ? (
          <button
            onClick={() => setShowPassword(true)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            <Lock size={14} /> {t("settings.account.changePassword")}
          </button>
        ) : (
          <div className="space-y-2 rounded-xl bg-text-primary/5 p-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("settings.account.currentPassword")}
              className="w-full h-10 px-3 rounded-lg bg-text-primary/5 text-sm text-text-primary outline-none focus:bg-text-primary/8"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("settings.account.newPassword")}
              className="w-full h-10 px-3 rounded-lg bg-text-primary/5 text-sm text-text-primary outline-none focus:bg-text-primary/8"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("settings.account.confirmPassword")}
              className="w-full h-10 px-3 rounded-lg bg-text-primary/5 text-sm text-text-primary outline-none focus:bg-text-primary/8"
              autoComplete="new-password"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleChangePassword}
                disabled={saving}
                className="h-9 px-4 rounded-lg bg-accent-action text-sm font-medium text-accent-action-foreground disabled:opacity-40"
              >
                {t("settings.account.changePasswordAction")}
              </button>
              <button
                onClick={() => {
                  setShowPassword(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                className="h-9 px-4 rounded-lg bg-text-primary/5 text-sm text-text-primary/60"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
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
