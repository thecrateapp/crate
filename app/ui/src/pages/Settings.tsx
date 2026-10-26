import { Slider } from "@crate/ui/primitives/Slider";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { Switch } from "@crate/ui/primitives/Switch";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Children,
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import { Input } from "@crate/ui/shadcn/input";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { FormField } from "@crate/ui/primitives/FormField";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";
import { Link, useSearchParams } from "react-router";
import { useActionLLMStatus, type ActionLLMStatus } from "@/hooks/use-llm";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { reasonText } from "@/lib/ai-models";
import { useAuth } from "@/contexts/AuthContext";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { taskLabel, useTaskCatalog } from "@/lib/task-catalog";
import { toast } from "sonner";
import { Loader2, X } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

const CACHE_ACTIONS = [
  { type: "all", label: "Clear All", variant: "outline" as const },
  { type: "enrichment", label: "Enrichment", variant: "outline" as const },
  { type: "lastfm", label: "Last.fm", variant: "outline" as const },
  { type: "analytics", label: "Analytics", variant: "outline" as const },
  { type: "paths_llm", label: "Music Paths AI", variant: "outline" as const },
];

// ── Types ──────────────────────────────────────────────────────

interface SettingsData {
  schedules: Record<string, number>;
  worker: { max_workers: number };
  enrichment: Record<string, boolean>;
  db_stats: Record<string, { size: number; rows: number }>;
  library: {
    path: string;
    storage_layout: string;
    audio_extensions: string[];
  };
  processing: {
    mb_auto_apply_threshold: number;
    enrichment_min_age_hours: number;
    max_track_popularity: number;
  };
  paths?: {
    llm_refinement_enabled: boolean;
    llm_refinement_cache_ttl_hours: number;
  };
  soulseek?: {
    url: string;
    quality: string;
    min_bitrate: number;
    username: string;
    shares_music: boolean;
  };
  telegram?: {
    enabled: boolean;
    bot_token: string;
    chat_id: string;
    has_token: boolean;
  };
  about: {
    version: string;
    git_commit: string;
    python: string;
    uptime_seconds: number;
    artists: number;
    albums: number;
    tracks: number;
    total_size_gb: number;
  };
}

interface DownloadPolicy {
  downloads_allowed_now: boolean;
  active_users: number;
  active_streams: number;
  time_window: {
    enabled: boolean;
    in_window: boolean;
    start: string;
    end: string;
  };
  user_limit: { enabled: boolean; max: number };
  stream_limit: { enabled: boolean; max: number };
}

interface AcquisitionStatus {
  tidal: { authenticated: boolean };
  soulseek: { connected: boolean; state: string };
}

interface AuditEntry {
  id: number;
  timestamp: string;
  action: string;
  target_type: string;
  target_name: string;
  details: Record<string, unknown>;
  user_id: number | null;
  task_id: string | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

function useSettingsWrite(path: string, successMessage = "Setting saved") {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function save(data: Record<string, unknown>, rollback: () => void) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await api(path, "PUT", data);
      toast.success(successMessage);
      return true;
    } catch {
      rollback();
      setError(
        "Changes could not be saved. The previous setting is kept; try again.",
      );
      toast.error("Failed to save");
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return { saving, error, save };
}

function SettingsWriteError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-state-warning-text">
      {message}
    </p>
  ) : null;
}

// ── Helpers ────────────────────────────────────────────────────

const ENRICHMENT_LABELS: Record<string, string> = {
  lastfm: "Last.fm",
  spotify: "Spotify",
  fanart: "Fanart.tv",
  setlistfm: "Setlist.fm",
  musicbrainz: "MusicBrainz",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  const diffMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Shared components ──────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <MonoLabel as="h3" tone="accent">
          {title}
        </MonoLabel>
        {description ? (
          <p className="text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <FormField
      kind="group"
      label={label}
      hint={hint}
      className="gap-x-3 border-b border-border-quiet-subtle py-3 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] md:items-center [&>[data-slot=form-field-hint]]:md:col-start-2"
    >
      {(field) => (
        <div
          {...field}
          role="group"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {Children.map(children, (child) => {
            if (
              !isValidElement<ComponentProps<"input">>(child) ||
              (child.type !== Input && child.type !== Slider)
            )
              return child;
            return cloneElement(child, {
              "aria-labelledby": child.props["aria-label"]
                ? child.props["aria-labelledby"]
                : field["aria-labelledby"],
              "aria-describedby":
                [child.props["aria-describedby"], field["aria-describedby"]]
                  .filter(Boolean)
                  .join(" ") || undefined,
            });
          })}
        </div>
      )}
    </FormField>
  );
}

function StatTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <StatNumber
      value={value}
      label={label}
      as="div"
      size="md"
      className={cn(
        "w-full min-w-0 border-t border-border-quiet py-3",
        className,
      )}
    />
  );
}

function PanelCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      aria-description={description}
      className="min-w-0 space-y-3"
    >
      {action ? <div className="flex justify-end">{action}</div> : null}
      {children}
    </div>
  );
}

// ── Sidebar nav ────────────────────────────────────────────────

type SettingsSection =
  | "general"
  | "downloads"
  | "schedules"
  | "enrichment"
  | "notifications"
  | "storage"
  | "audit";

const NAV_ITEMS: {
  id: SettingsSection;
  label: string;
  description: string;
}[] = [
  {
    id: "general",
    label: "General",
    description: "Library, worker and runtime basics",
  },
  {
    id: "downloads",
    label: "Downloads",
    description: "Tidal, Soulseek and quiet hours",
  },
  {
    id: "schedules",
    label: "Schedules",
    description: "Recurring tasks and cadence",
  },
  {
    id: "enrichment",
    label: "Enrichment",
    description: "Sources, thresholds and file types",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Telegram bot and alerts",
  },
  {
    id: "storage",
    label: "Storage",
    description: "Database footprint and cache tools",
  },
  {
    id: "audit",
    label: "Audit Log",
    description: "Operational trail and filters",
  },
];

// ── Main ───────────────────────────────────────────────────────

export function Settings() {
  const {
    data: settings,
    loading,
    refetch,
  } = useApi<SettingsData>("/api/settings");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const section = NAV_ITEMS.some((item) => item.id === requestedSection)
    ? (requestedSection as SettingsSection)
    : "general";
  const selectSection = (nextSection: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextSection === "general") next.delete("section");
      else next.set("section", nextSection);
      return next;
    });
  };

  if (loading) {
    return <LoadingState label="Loading settings" className="py-20" />;
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <OpsPageHero
          title="Settings"
          description="Runtime, library, enrichment and notification controls."
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-8">
            <div>
              <MonoLabel as="h2" tone="accent">
                Settings unavailable
              </MonoLabel>
              <p role="alert" className="mt-2 text-sm text-text-muted">
                Settings could not be loaded. Your saved configuration has not
                changed.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentNav =
    NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0]!;

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Settings"
        description="Runtime, library, enrichment and notification controls."
      />

      <Tabs value={section} onValueChange={selectSection} className="gap-5">
        <TabsList aria-label="Settings sections">
          {NAV_ITEMS.map(({ id, label }) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          value={section}
          aria-label={`${currentNav.label} settings`}
          className="mt-0 space-y-5"
        >
          <p className="text-sm text-text-muted">{currentNav.description}</p>

          {section === "general" && <GeneralSection settings={settings} />}
          {section === "downloads" && (
            <DownloadsSection soulseek={settings.soulseek} />
          )}
          {section === "schedules" && (
            <SchedulesSection
              schedules={settings.schedules}
              refetch={refetch}
            />
          )}
          {section === "enrichment" && (
            <EnrichmentSection settings={settings} refetch={refetch} />
          )}
          {section === "notifications" && (
            <NotificationsSection
              telegram={settings.telegram}
              refetch={refetch}
            />
          )}
          {section === "storage" && (
            <StorageSection dbStats={settings.db_stats} />
          )}
          {section === "audit" && <AuditSection />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── General ────────────────────────────────────────────────────

function GeneralSection({ settings }: { settings: SettingsData }) {
  const { data: opsSnapshot } = useOpsSnapshot();
  const worker = opsSnapshot?.live;
  const pendingTasks = opsSnapshot?.stats.pending_tasks ?? 0;
  const dbHeavyGate = worker?.db_heavy_gate;
  const about = settings.about;

  return (
    <>
      <Section
        title="Library"
        description="Core library path, storage layout and current footprint."
      >
        <PanelCard
          title="Library Runtime"
          description="Where Crate reads from and how the indexed collection is currently shaped."
        >
          <FieldRow label="Path">
            <code className="rounded-md border border-border-quiet bg-card px-3 py-2 font-mono text-sm">
              {settings.library?.path || "/music"}
            </code>
          </FieldRow>
          <FieldRow label="Layout">
            <span className="text-sm">
              {settings.library?.storage_layout || "artist/album"}
            </span>
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Artists" value={formatNumber(about.artists)} />
            <StatTile label="Albums" value={formatNumber(about.albums)} />
            <StatTile label="Tracks" value={formatNumber(about.tracks)} />
            <StatTile label="Size" value={`${about.total_size_gb} GB`} />
          </div>
        </PanelCard>
      </Section>

      <Section
        title="Worker"
        description="Live execution engine status, running work and queue pressure."
      >
        <PanelCard
          title="Worker Engine"
          description="Background tasks, pool health and current queue state."
        >
          <FieldRow label="Engine">
            <span className="rounded-md border border-border-quiet bg-card px-3 py-2 font-mono text-sm">
              {worker?.engine || "dramatiq"}
            </span>
          </FieldRow>
          <FieldRow label="Status">
            <div className="flex items-center gap-3">
              {worker && worker.running_tasks.length > 0 ? (
                <Badge className="border-primary/30 bg-primary/15 text-primary">
                  {worker.running_tasks.length} running
                </Badge>
              ) : (
                <Badge variant="secondary">Idle</Badge>
              )}
              {pendingTasks > 0 && (
                <Badge variant="secondary">{pendingTasks} pending</Badge>
              )}
              {dbHeavyGate &&
                (dbHeavyGate.active > 0 || dbHeavyGate.pending > 0) && (
                  <Badge variant="secondary">
                    DB-heavy {dbHeavyGate.active}/{dbHeavyGate.pending}
                  </Badge>
                )}
            </div>
          </FieldRow>
          {dbHeavyGate &&
            (dbHeavyGate.active > 0 || dbHeavyGate.pending > 0) && (
              <div className="rounded-md border border-border-quiet-subtle bg-card px-3 py-2 text-xs text-muted-foreground">
                DB-heavy tasks are serialized. Free worker slots can still
                appear idle while a heavy task is queued behind another heavy
                task.
              </div>
            )}
          {worker && worker.running_tasks.length > 0 && (
            <div className="space-y-2 pt-1">
              {worker.running_tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border border-border-quiet-subtle bg-card px-3 py-2 text-xs text-muted-foreground"
                >
                  <Loader2 size={10} className="animate-spin text-primary" />
                  <span className="font-mono">{t.type}</span>
                  <span className="text-text-subtle">{t.id}</span>
                  <Badge variant="outline">{t.pool}</Badge>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </Section>

      <Section
        title="About"
        description="Runtime identity and deployment metadata for this admin instance."
      >
        <PanelCard
          title="Build & Runtime"
          description="Version fingerprint, Python runtime and current process uptime."
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Version", value: about.version },
              { label: "Python", value: about.python },
              { label: "Uptime", value: formatUptime(about.uptime_seconds) },
              {
                label: "Commit",
                value: about.git_commit?.slice(0, 8),
                mono: true,
              },
            ].map(({ label, value, mono }) => (
              <StatNumber
                key={label}
                value={
                  mono ? (
                    <span className="font-mono text-sm">{value}</span>
                  ) : (
                    value
                  )
                }
                label={label}
                as="div"
                size="sm"
                className="w-full min-w-0 border-t border-border-quiet py-3"
              />
            ))}
          </div>
        </PanelCard>
      </Section>
    </>
  );
}

// ── Downloads ──────────────────────────────────────────────────

function DownloadsSection({
  soulseek,
}: {
  soulseek: SettingsData["soulseek"];
}) {
  return (
    <>
      <TidalCard />
      <SoulseekCard settings={soulseek} />
      <DownloadWindowCard />
    </>
  );
}

function TidalCard() {
  const {
    data: acqStatus,
    loading,
    error,
    refetch,
  } = useApi<AcquisitionStatus>("/api/acquisition/status");
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);

  const authenticated = acqStatus?.tidal?.authenticated ?? false;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const r = await api<{ success: boolean }>(
        "/api/tidal/auth/refresh",
        "POST",
      );
      if (r.success) {
        toast.success("Tidal token refreshed");
        refetch();
      } else toast.error("Refresh failed");
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLogin() {
    setLoggingIn(true);
    setDeviceUrl(null);
    try {
      const res = await fetch("/api/tidal/auth/login", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok || !res.body) {
        toast.error("Failed to start Tidal login");
        setLoggingIn(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const msg = line.slice(6).trim();
          // Extract URL from tiddl output
          const urlMatch = msg.match(/https?:\/\/[^\s]+/);
          if (urlMatch && !deviceUrl) {
            setDeviceUrl(urlMatch[0]);
            window.open(urlMatch[0], "_blank", "noopener");
          }
          if (msg === "AUTH_SUCCESS") {
            setLoggingIn(false);
            setDeviceUrl(null);
            toast.success("Tidal authenticated");
            refetch();
            return;
          } else if (
            msg.startsWith("AUTH_FAILED") ||
            msg.startsWith("AUTH_ERROR") ||
            msg.startsWith("AUTH_TIMEOUT")
          ) {
            setLoggingIn(false);
            setDeviceUrl(null);
            toast.error("Tidal login failed");
            return;
          }
        }
      }
      setLoggingIn(false);
    } catch {
      setLoggingIn(false);
      toast.error("Login failed");
    }
  }

  async function handleLogout() {
    try {
      await api("/api/tidal/auth/logout", "POST");
      toast.success("Tidal logged out");
      refetch();
    } catch {
      toast.error("Logout failed");
    }
  }

  return (
    <Section
      title="Tidal"
      description="Authentication and token health for Tidal acquisition."
    >
      <PanelCard
        title="Tidal Access"
        description="Manage the current device auth session and token refresh flow."
      >
        {!acqStatus ? (
          loading ? (
            <LoadingState label="Loading Tidal status" />
          ) : (
            <ErrorState
              message="Tidal status could not be loaded."
              onRetry={refetch}
              retryLabel="Retry Tidal status"
            />
          )
        ) : (
          <>
            {error ? (
              <ErrorState
                message="Tidal status could not be refreshed. Showing the last confirmed status."
                onRetry={refetch}
                retryLabel="Retry Tidal status"
              />
            ) : null}
            <FieldRow label="Status">
              <StatusDot
                tone={authenticated ? "on" : "warn"}
                title={authenticated ? "Connected" : "Not connected"}
              />
              <span className="text-sm">
                {authenticated ? "Authenticated" : "Not authenticated"}
              </span>
            </FieldRow>
            <div className="flex flex-wrap gap-2 md:pl-[212px]">
              {authenticated ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                  >
                    {refreshing ? (
                      <Loader2 size={12} className="animate-spin mr-1.5" />
                    ) : null}
                    Refresh Token
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLogout}>
                    Logout
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={handleLogin} disabled={loggingIn}>
                  {loggingIn ? (
                    <Loader2 size={12} className="animate-spin mr-1.5" />
                  ) : null}
                  {loggingIn ? "Waiting for auth..." : "Login to Tidal"}
                </Button>
              )}
            </div>
            {loggingIn && deviceUrl && (
              <div className="md:pl-[212px]">
                <p className="text-xs text-muted-foreground">
                  A login page should have opened.{" "}
                  <a
                    href={deviceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Click here if it didn't open
                  </a>
                </p>
              </div>
            )}
          </>
        )}
      </PanelCard>
    </Section>
  );
}

function SoulseekCard({ settings }: { settings: SettingsData["soulseek"] }) {
  const {
    data: acqStatus,
    loading,
    error,
    refetch,
  } = useApi<AcquisitionStatus>("/api/acquisition/status");
  const slsk = acqStatus?.soulseek;
  const connected = slsk?.connected ?? false;

  const [quality, setQuality] = useState(settings?.quality || "flac");
  const [minBitrate, setMinBitrate] = useState(
    String(settings?.min_bitrate ?? 320),
  );
  const confirmed = useRef({ quality, minBitrate });
  const write = useSettingsWrite(
    "/api/settings/soulseek",
    "Soulseek settings saved",
  );

  async function saveQuality(next: string) {
    const previous = confirmed.current.quality;
    setQuality(next);
    if (await write.save({ quality: next }, () => setQuality(previous)))
      confirmed.current.quality = next;
  }

  async function saveBitrate() {
    const previous = confirmed.current.minBitrate;
    const next = String(Number.parseInt(minBitrate, 10) || 320);
    setMinBitrate(next);
    if (
      await write.save({ min_bitrate: Number(next) }, () =>
        setMinBitrate(previous),
      )
    )
      confirmed.current.minBitrate = next;
  }

  return (
    <Section
      title="Soulseek"
      description="Fallback acquisition quality policy and slskd connectivity."
    >
      <PanelCard
        title="Soulseek Preferences"
        description="Acquisition quality defaults and current daemon connection state."
      >
        <FieldRow label="Status">
          {!acqStatus ? (
            loading ? (
              <LoadingState label="Loading Soulseek status" />
            ) : (
              <ErrorState
                message="Soulseek status could not be loaded."
                onRetry={refetch}
                retryLabel="Retry Soulseek status"
              />
            )
          ) : (
            <>
              <StatusDot
                tone={connected ? "on" : "warn"}
                title={connected ? "Connected" : "Not connected"}
              />
              <span className="text-sm">
                {connected ? `Connected (${slsk?.state})` : "Disconnected"}
              </span>
              {!connected && (
                <span className="text-[10px] text-text-subtle">
                  slskd container not running
                </span>
              )}
            </>
          )}
        </FieldRow>
        {error && acqStatus ? (
          <ErrorState
            message="Soulseek status could not be refreshed. Showing the last confirmed status."
            onRetry={refetch}
            retryLabel="Retry Soulseek status"
          />
        ) : null}
        <FieldRow label="Quality">
          <SegmentedControl
            as="radio"
            label="Quality"
            value={quality}
            onValueChange={(value) => void saveQuality(value)}
            items={[
              { value: "flac", label: "FLAC only", disabled: write.saving },
              {
                value: "flac_320",
                label: "FLAC + MP3 320k",
                disabled: write.saving,
              },
              { value: "any", label: "Any quality", disabled: write.saving },
            ]}
          />
        </FieldRow>
        <FieldRow label="Min bitrate">
          <Input
            type="number"
            className="h-10 w-24"
            value={minBitrate}
            disabled={write.saving}
            onChange={(e) => setMinBitrate(e.target.value)}
            onBlur={() => void saveBitrate()}
          />
          <span className="text-xs text-muted-foreground">kbps</span>
        </FieldRow>
        <SettingsWriteError message={write.error} />
      </PanelCard>
    </Section>
  );
}

function DownloadWindowCard() {
  const {
    data: policy,
    loading,
    error,
    refetch,
  } = useApi<DownloadPolicy>("/api/admin/download-policy");
  return (
    <Section
      title="Download Policy"
      description="Quiet hours and concurrency limits that gate acquisition."
    >
      <PanelCard
        title="Quiet Hours & Limits"
        description="Keep downloads out of busy listening windows and cap concurrent activity."
      >
        {!policy ? (
          loading ? (
            <LoadingState label="Loading download policy" />
          ) : (
            <ErrorState
              message="Download policy could not be loaded."
              onRetry={refetch}
              retryLabel="Retry download policy"
            />
          )
        ) : (
          <>
            {error ? (
              <ErrorState
                message="Download policy could not be refreshed. Showing the last confirmed settings."
                onRetry={refetch}
                retryLabel="Retry download policy"
              />
            ) : null}
            <DownloadPolicyForm policy={policy} refetch={refetch} />
          </>
        )}
      </PanelCard>
    </Section>
  );
}

function DownloadPolicyForm({
  policy,
  refetch,
}: {
  policy: DownloadPolicy;
  refetch: () => void;
}) {
  const [windowEnabled, setWindowEnabled] = useState(
    policy.time_window.enabled,
  );
  const [windowStart, setWindowStart] = useState(policy.time_window.start);
  const [windowEnd, setWindowEnd] = useState(policy.time_window.end);
  const [maxUsers, setMaxUsers] = useState(String(policy.user_limit.max));
  const [maxStreams, setMaxStreams] = useState(String(policy.stream_limit.max));
  const confirmed = useRef({
    window_enabled: policy.time_window.enabled,
    window_start: policy.time_window.start,
    window_end: policy.time_window.end,
    max_active_users: policy.user_limit.max,
    max_active_streams: policy.stream_limit.max,
  });
  const write = useSettingsWrite(
    "/api/admin/download-policy",
    "Download policy updated",
  );

  async function commit<K extends keyof typeof confirmed.current>(
    key: K,
    value: (typeof confirmed.current)[K],
    restore: (value: (typeof confirmed.current)[K]) => void,
  ) {
    const previous = confirmed.current[key];
    if (await write.save({ [key]: value }, () => restore(previous))) {
      confirmed.current[key] = value;
      refetch();
    }
  }

  return (
    <div aria-busy={write.saving}>
      <FieldRow label="Current status">
        <Badge
          className={
            policy.downloads_allowed_now
              ? "bg-accent-action/10 text-accent-action-hi border-accent-action/20"
              : "bg-state-warning/10 text-state-warning-text border-state-warning/20"
          }
        >
          {policy.downloads_allowed_now
            ? "Downloads active"
            : "Downloads paused"}
        </Badge>
        {policy.active_users > 0 ? (
          <span className="text-xs text-muted-foreground">
            {policy.active_users} user{policy.active_users > 1 ? "s" : ""}{" "}
            active
          </span>
        ) : null}
      </FieldRow>
      <FieldRow
        label="Time window"
        hint="Only allow downloads during these hours"
      >
        <Toggle
          checked={windowEnabled}
          ariaLabel="Time window"
          disabled={write.saving}
          onChange={(next) => {
            setWindowEnabled(next);
            void commit("window_enabled", next, setWindowEnabled);
          }}
        />
        {windowEnabled ? (
          <>
            <Input
              type="time"
              aria-label="Time window start"
              className="w-28"
              disabled={write.saving}
              value={windowStart}
              onChange={(event) => setWindowStart(event.target.value)}
              onBlur={() =>
                void commit("window_start", windowStart, setWindowStart)
              }
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="time"
              aria-label="Time window end"
              className="w-28"
              disabled={write.saving}
              value={windowEnd}
              onChange={(event) => setWindowEnd(event.target.value)}
              onBlur={() => void commit("window_end", windowEnd, setWindowEnd)}
            />
          </>
        ) : null}
      </FieldRow>
      <FieldRow
        label="Max active users"
        hint="Pause if more than N users listening"
      >
        <Input
          type="number"
          min={0}
          className="w-24"
          disabled={write.saving}
          value={maxUsers}
          onChange={(event) => setMaxUsers(event.target.value)}
          onBlur={() =>
            void commit(
              "max_active_users",
              Number.parseInt(maxUsers, 10) || 0,
              (previous) => setMaxUsers(String(previous)),
            )
          }
        />
        <span className="text-xs text-text-subtle">0 = no limit</span>
      </FieldRow>
      <FieldRow
        label="Max active streams"
        hint="Pause if more than N concurrent streams"
      >
        <Input
          type="number"
          min={0}
          className="w-24"
          disabled={write.saving}
          value={maxStreams}
          onChange={(event) => setMaxStreams(event.target.value)}
          onBlur={() =>
            void commit(
              "max_active_streams",
              Number.parseInt(maxStreams, 10) || 0,
              (previous) => setMaxStreams(String(previous)),
            )
          }
        />
        <span className="text-xs text-text-subtle">0 = no limit</span>
      </FieldRow>
      <SettingsWriteError message={write.error} />
    </div>
  );
}

// ── Schedules ──────────────────────────────────────────────────

function SchedulesSection({
  schedules,
  refetch,
}: {
  schedules: Record<string, number>;
  refetch: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(schedules)) {
      m[k] = v === 0 ? "0" : String(Math.round(v / 60));
    }
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [runningType, setRunningType] = useState<string | null>(null);
  useTaskCatalog();

  async function runNow(taskType: string) {
    const label = taskLabel(taskType);
    setRunningType(taskType);
    try {
      const result = await api<{ status: string }>(
        `/api/worker/schedules/${encodeURIComponent(taskType)}/run`,
        "POST",
      );
      if (result.status === "already_queued") {
        toast.info(`${label} is already queued`);
      } else {
        toast.success(`${label} queued`);
      }
    } catch {
      toast.error(`${label} could not be started`);
    } finally {
      setRunningType(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(draft)) {
        const mins = parseInt(v, 10);
        payload[k] = isNaN(mins) || mins <= 0 ? 0 : mins * 60;
      }
      await api("/api/settings/schedules", "PUT", payload);
      toast.success("Schedules saved");
      refetch();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Task Schedules"
      description="Intervals for recurring maintenance and enrichment jobs."
    >
      <PanelCard
        title="Recurring Jobs"
        description="Set the cadence for background maintenance. `0` disables a schedule."
        action={
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 size={12} className="mr-1.5 animate-spin" />
            ) : null}
            Save Schedules
          </Button>
        }
      >
        {Object.keys(schedules).map((key) => {
          const mins = draft[key] ?? "0";
          const active = mins !== "0" && mins !== "";
          return (
            <FieldRow key={key} label={taskLabel(key)}>
              <Input
                type="number"
                min={0}
                className="h-10 w-24"
                value={mins}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Badge variant={active ? "default" : "secondary"}>
                {active ? "Active" : "Off"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runNow(key)}
                disabled={runningType !== null}
                aria-label={`Run ${taskLabel(key)} now`}
              >
                {runningType === key ? (
                  <Loader2 size={12} className="mr-1.5 animate-spin" />
                ) : null}
                Run now
              </Button>
            </FieldRow>
          );
        })}
      </PanelCard>
    </Section>
  );
}

// ── Enrichment ─────────────────────────────────────────────────

function ManageInAiModelsLink({ canManageAi }: { canManageAi: boolean }) {
  if (!canManageAi) return <>Manage in AI models</>;
  return (
    <Link className="text-primary underline" to="/ai">
      Manage in AI models
    </Link>
  );
}

function AIRefinementStatus({
  pathAI,
  canManageAi,
  llmRefinementEnabled,
  savingPaths,
  savePathsSetting,
  cacheTtlHours,
}: {
  pathAI: ActionLLMStatus | null;
  canManageAi: boolean;
  llmRefinementEnabled: boolean;
  savingPaths: boolean;
  savePathsSetting: (enabled: boolean) => void;
  cacheTtlHours: number;
}) {
  if (!pathAI) {
    return <p className="text-sm text-text-muted">Checking AI refinement…</p>;
  }

  if (pathAI.status === "legacy") {
    return (
      <FieldRow
        label="AI refinement"
        hint={
          pathAI.available
            ? `Uses ${pathAI.model_id} from server settings. Accepted refinements are cached for ${cacheTtlHours} hours.`
            : `Unavailable: ${reasonText(pathAI.error_code)}.`
        }
      >
        <Toggle
          checked={llmRefinementEnabled}
          onChange={savePathsSetting}
          disabled={savingPaths}
          ariaLabel="AI refinement"
        />
        <Badge
          variant={llmRefinementEnabled ? "default" : "secondary"}
          className="text-[10px]"
        >
          {llmRefinementEnabled ? "Enabled" : "Disabled"}
        </Badge>
        {savingPaths ? (
          <Loader2 size={13} className="animate-spin text-muted-foreground" />
        ) : null}
        <span className="text-sm">
          <ManageInAiModelsLink canManageAi={canManageAi} />
        </span>
      </FieldRow>
    );
  }

  if (pathAI.status === "configured") {
    return (
      <p className="text-sm">
        AI refinement: On · uses {pathAI.model_id} ·{" "}
        <ManageInAiModelsLink canManageAi={canManageAi} />
      </p>
    );
  }

  if (pathAI.error_code === "AI_ACTION_DISABLED") {
    return (
      <p className="text-sm">
        AI refinement: Off · <ManageInAiModelsLink canManageAi={canManageAi} />
      </p>
    );
  }

  return (
    <p className="text-sm">
      AI refinement: Unavailable · {reasonText(pathAI.error_code)} ·{" "}
      <ManageInAiModelsLink canManageAi={canManageAi} />
    </p>
  );
}

function EnrichmentSection({
  settings,
  refetch,
}: {
  settings: SettingsData;
  refetch: () => void;
}) {
  const pathAI = useActionLLMStatus("music_paths.refine");
  const { hasCapability } = useAuth();
  const canManageAi = hasCapability("ai.config.read");
  const enrichment = settings.enrichment;
  const proc = settings.processing ?? {
    mb_auto_apply_threshold: 85,
    enrichment_min_age_hours: 24,
    max_track_popularity: 50,
  };
  const paths = settings.paths ?? {
    llm_refinement_enabled: true,
    llm_refinement_cache_ttl_hours: 168,
  };
  const exts = settings.library?.audio_extensions ?? [
    ".flac",
    ".mp3",
    ".ogg",
    ".opus",
    ".m4a",
  ];

  const [draft, setDraft] = useState<Record<string, boolean>>({
    ...enrichment,
  });
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(proc.mb_auto_apply_threshold);
  const [minAge, setMinAge] = useState(proc.enrichment_min_age_hours);
  const [maxPop, setMaxPop] = useState(proc.max_track_popularity);
  const [llmRefinementEnabled, setLlmRefinementEnabled] = useState(
    paths.llm_refinement_enabled,
  );
  const [savingPaths, setSavingPaths] = useState(false);
  const [audioExts, setAudioExts] = useState<string[]>(exts);
  const [newExt, setNewExt] = useState("");
  const processingWrite = useSettingsWrite("/api/settings/processing");
  const extensionsWrite = useSettingsWrite("/api/settings/library");
  const confirmedProcessing = useRef({ ...proc });
  const confirmedExtensions = useRef(exts);

  async function saveProcessing<K extends keyof SettingsData["processing"]>(
    key: K,
    value: SettingsData["processing"][K],
  ) {
    const previous = confirmedProcessing.current[key];
    const restore = () => {
      if (key === "mb_auto_apply_threshold") setThreshold(previous);
      else if (key === "enrichment_min_age_hours") setMinAge(previous);
      else setMaxPop(previous);
    };
    if (await processingWrite.save({ [key]: value }, restore))
      confirmedProcessing.current[key] = value;
  }

  async function saveExtensions(updated: string[]) {
    const previous = confirmedExtensions.current;
    setAudioExts(updated);
    if (
      await extensionsWrite.save({ audio_extensions: updated }, () =>
        setAudioExts(previous),
      )
    )
      confirmedExtensions.current = updated;
  }

  useEffect(() => {
    setLlmRefinementEnabled(paths.llm_refinement_enabled);
  }, [paths.llm_refinement_enabled]);

  async function saveEnrichment() {
    setSaving(true);
    try {
      await api("/api/settings/enrichment", "PUT", draft);
      toast.success("Enrichment sources saved");
      refetch();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function savePathsSetting(enabled: boolean) {
    const previous = llmRefinementEnabled;
    setLlmRefinementEnabled(enabled);
    setSavingPaths(true);
    try {
      await api("/api/settings/paths", "PUT", {
        llm_refinement_enabled: enabled,
      });
      toast.success("Music Paths settings saved");
      refetch();
    } catch {
      setLlmRefinementEnabled(previous);
      toast.error("Failed to save Music Paths settings");
    } finally {
      setSavingPaths(false);
    }
  }

  function removeExt(ext: string) {
    const updated = audioExts.filter((e) => e !== ext);
    void saveExtensions(updated);
  }

  function addExt() {
    const ext = newExt.trim().toLowerCase();
    if (!ext) return;
    const normalized = ext.startsWith(".") ? ext : `.${ext}`;
    if (audioExts.includes(normalized)) return;
    const updated = [...audioExts, normalized];
    setNewExt("");
    void saveExtensions(updated);
  }

  return (
    <>
      <Section
        title="Sources"
        description="Enable or disable the remote metadata providers Crate can use."
      >
        <PanelCard
          title="Enrichment Sources"
          description="Toggle providers that feed artist, album and social metadata into the library."
          action={
            <Button size="sm" onClick={saveEnrichment} disabled={saving}>
              {saving ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : null}
              Save Sources
            </Button>
          }
        >
          {Object.keys(enrichment).map((key) => (
            <FieldRow key={key} label={ENRICHMENT_LABELS[key] ?? key}>
              <Toggle
                checked={draft[key] ?? false}
                onChange={(v) => setDraft((prev) => ({ ...prev, [key]: v }))}
                ariaLabel={ENRICHMENT_LABELS[key] ?? key}
              />
            </FieldRow>
          ))}
        </PanelCard>
      </Section>

      <Section
        title="Music Paths"
        description="Control the optional AI review pass used after deterministic path generation."
      >
        <PanelCard
          title="AI refinement"
          description="An optional AI review after Crate computes a path. Paths work without it."
        >
          <AIRefinementStatus
            pathAI={pathAI}
            canManageAi={canManageAi}
            llmRefinementEnabled={llmRefinementEnabled}
            savingPaths={savingPaths}
            savePathsSetting={savePathsSetting}
            cacheTtlHours={paths.llm_refinement_cache_ttl_hours}
          />
        </PanelCard>
      </Section>

      <Section
        title="Processing"
        description="Thresholds and limits that shape matching and scoring behavior."
      >
        <PanelCard
          title="Processing Rules"
          description="Tune matcher confidence, re-enrichment freshness and popularity coverage."
        >
          <FieldRow
            label="MB auto-apply"
            hint="Min match score to auto-apply tags"
          >
            <Slider
              aria-label="MB auto-apply"
              min={50}
              max={100}
              value={threshold}
              disabled={processingWrite.saving}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onMouseUp={() =>
                void saveProcessing("mb_auto_apply_threshold", threshold)
              }
              onTouchEnd={() =>
                void saveProcessing("mb_auto_apply_threshold", threshold)
              }
              onKeyUp={(event) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(event.key)
                ) {
                  void saveProcessing(
                    "mb_auto_apply_threshold",
                    Number(event.currentTarget.value),
                  );
                }
              }}
              className="w-32"
            />
            <span className="text-sm font-mono w-10 text-right">
              {threshold}%
            </span>
          </FieldRow>
          <FieldRow label="Re-enrich age" hint="Min hours before re-enriching">
            <Input
              type="number"
              min={1}
              max={168}
              className="h-10 w-24"
              value={minAge}
              disabled={processingWrite.saving}
              onChange={(e) => setMinAge(Number(e.target.value))}
              onBlur={() =>
                void saveProcessing("enrichment_min_age_hours", minAge)
              }
            />
            <span className="text-xs text-muted-foreground">hours</span>
          </FieldRow>
          <FieldRow
            label="Track popularity"
            hint="Max tracks per artist for popularity"
          >
            <Input
              type="number"
              min={10}
              max={500}
              className="h-10 w-24"
              value={maxPop}
              disabled={processingWrite.saving}
              onChange={(e) => setMaxPop(Number(e.target.value))}
              onBlur={() => void saveProcessing("max_track_popularity", maxPop)}
            />
            <span className="text-xs text-muted-foreground">tracks</span>
          </FieldRow>
          <SettingsWriteError message={processingWrite.error} />
        </PanelCard>
      </Section>

      <Section
        title="Audio Extensions"
        description="Recognized source formats when scanning and importing music."
      >
        <PanelCard
          title="Accepted Audio Extensions"
          description="Control which file types the library watcher and sync jobs should treat as music."
        >
          <div className="flex flex-wrap gap-1.5">
            {audioExts.map((ext) => (
              <div key={ext} className="inline-flex items-center gap-1">
                <Badge variant="secondary">{ext}</Badge>
                <ActionButton
                  label={`Remove ${ext}`}
                  tooltip="Remove extension"
                  onClick={() => removeExt(ext)}
                  disabled={extensionsWrite.saving}
                >
                  <X aria-hidden="true" />
                </ActionButton>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="h-10 w-28"
              placeholder=".wav"
              value={newExt}
              aria-label="Audio extension"
              disabled={extensionsWrite.saving}
              onChange={(e) => setNewExt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addExt();
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addExt}
              disabled={extensionsWrite.saving}
            >
              {" "}
              Add
            </Button>
          </div>
          <SettingsWriteError message={extensionsWrite.error} />
        </PanelCard>
      </Section>
    </>
  );
}

// ── Notifications ──────────────────────────────────────────────

function NotificationsSection({
  telegram,
  refetch,
}: {
  telegram?: SettingsData["telegram"];
  refetch: () => void;
}) {
  const [enabled, setEnabled] = useState(telegram?.enabled ?? false);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(telegram?.chat_id ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEnabled(telegram?.enabled ?? false);
    setChatId(telegram?.chat_id ?? "");
  }, [telegram]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { enabled, chat_id: chatId };
      if (token) body.bot_token = token;
      await api("/api/settings/telegram", "PUT", body);
      toast.success("Telegram settings saved");
      setToken("");
      refetch();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await api("/api/settings/telegram/test", "POST");
      toast.success("Test message sent");
    } catch {
      toast.error("Test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section
      title="Telegram Bot"
      description="Outbound operational notifications and test delivery."
    >
      <PanelCard
        title="Telegram Notifications"
        description="Send task and system messages through a bot linked to your chat."
      >
        <FieldRow label="Enabled">
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            ariaLabel="Telegram notifications"
          />
          <Badge variant={enabled ? "default" : "secondary"}>
            {enabled ? "Active" : "Disabled"}
          </Badge>
        </FieldRow>
        <FieldRow label="Bot Token">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              telegram?.has_token ? "Token configured" : "Paste from @BotFather"
            }
            className="max-w-sm"
          />
        </FieldRow>
        <FieldRow label="Chat ID">
          <Input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Auto-filled on /start"
            className="max-w-sm"
          />
        </FieldRow>
        <div className="flex flex-wrap items-center gap-2 md:pl-[212px] pt-1">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? (
              <Loader2 size={12} className="animate-spin mr-1.5" />
            ) : null}
            Save
          </Button>
          <Button
            onClick={test}
            disabled={testing || !telegram?.has_token}
            variant="outline"
            size="sm"
          >
            {testing ? (
              <Loader2 size={12} className="animate-spin mr-1.5" />
            ) : null}
            Send Test
          </Button>
        </div>
        <p className="text-[10px] text-text-subtle md:pl-[212px]">
          Create a bot via @BotFather, paste the token, then send /start to it.
        </p>
      </PanelCard>
    </Section>
  );
}

// ── Storage ────────────────────────────────────────────────────

function StorageSection({
  dbStats,
}: {
  dbStats: Record<string, { size: number; rows: number }>;
}) {
  const [clearing, setClearing] = useState<string | null>(null);

  async function clearCache(type: string) {
    setClearing(type);
    try {
      await api("/api/settings/cache/clear", "POST", { type });
      toast.success(`Cache cleared: ${type}`);
    } catch {
      toast.error(`Failed to clear ${type}`);
    } finally {
      setClearing(null);
    }
  }

  return (
    <>
      <Section
        title="Database"
        description="Table volume and on-disk footprint for the current instance."
      >
        <PanelCard
          title="Database Footprint"
          description="Row counts and size by table to spot growth and hot spots."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider font-mono">
                  Table
                </TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wider font-mono">
                  Rows
                </TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wider font-mono">
                  Size
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(dbStats).map(([name, stats]) => (
                <TableRow key={name} className="border-border-quiet-subtle">
                  <TableCell className="text-sm font-mono py-1.5">
                    {name}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground py-1.5">
                    {stats.rows.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground py-1.5">
                    {formatBytes(stats.size)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelCard>
      </Section>

      <Section
        title="Cache"
        description="Targeted eviction for stale derived data and remote metadata caches."
      >
        <PanelCard
          title="Cache Controls"
          description="Clear derived data without touching the underlying library."
        >
          <div className="flex gap-2 flex-wrap">
            {CACHE_ACTIONS.map(({ type, label, variant }) => (
              <Button
                key={type}
                variant={variant}
                size="sm"
                onClick={() => clearCache(type)}
                disabled={clearing !== null}
              >
                {clearing === type ? (
                  <Loader2 size={12} className="animate-spin mr-1.5" />
                ) : null}
                {label}
              </Button>
            ))}
          </div>
        </PanelCard>
      </Section>
    </>
  );
}

// ── Audit ──────────────────────────────────────────────────────

function AuditSection() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestRef = useRef(0);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const limit = 50;

  const load = useCallback(
    async (reset: boolean, currentOffset = 0) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setLoadError(false);
      try {
        const newOffset = reset ? 0 : currentOffset;
        const filterParam =
          actionFilter !== "all" ? `&action=${actionFilter}` : "";
        const res = await api<AuditResponse>(
          `/api/manage/audit-log?limit=${limit}&offset=${newOffset}${filterParam}`,
        );
        if (requestId !== requestRef.current) return;
        if (reset) {
          setEntries(res.entries);
          setOffset(res.entries.length);
        } else {
          setEntries((prev) => [...prev, ...res.entries]);
          setOffset((prev) => prev + res.entries.length);
        }
        setTotal(res.total);
      } catch {
        if (requestId !== requestRef.current) return;
        setLoadError(true);
        toast.error("Failed to load audit log");
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [actionFilter],
  );

  useEffect(() => {
    void load(true);
    return () => {
      requestRef.current += 1;
    };
  }, [actionFilter, load]);

  const actions = [...new Set(entries.map((e) => e.action))].sort();

  return (
    <Section
      title="Audit Log"
      description="Operational history of changes, jobs and admin actions."
    >
      <PanelCard
        title="Operational Timeline"
        description="Filter and inspect recent admin activity across the system."
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-muted-foreground">
            {total > 0 ? `${total} entries` : ""}
          </span>
          <AdminSelect
            value={actionFilter}
            onChange={setActionFilter}
            options={[
              { value: "all", label: "All actions" },
              ...actions.map((action) => ({ value: action, label: action })),
            ]}
            placeholder="Filter actions"
            allowClear={false}
            triggerClassName="max-w-[220px]"
          />
        </div>

        {loading && entries.length === 0 ? (
          <LoadingState label="Loading audit log" />
        ) : loadError && entries.length === 0 ? (
          <ErrorState
            message="Audit log could not be loaded."
            onRetry={() => void load(true)}
            retryLabel="Retry audit log"
          />
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No entries
          </div>
        ) : (
          <>
            {loadError ? (
              <ErrorState
                message="Audit log could not be refreshed. Showing the last successful results."
                onRetry={() => void load(true)}
                retryLabel="Retry audit log"
              />
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider font-mono">
                    Time
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-mono">
                    Action
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-mono">
                    Type
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-mono">
                    Target
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className="border-border-quiet-subtle"
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-1.5">
                      <TooltipHint
                        content={new Date(entry.timestamp).toLocaleString()}
                      >
                        <time dateTime={entry.timestamp} tabIndex={0}>
                          {formatTimestamp(entry.timestamp)}
                        </time>
                      </TooltipHint>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant="outline">{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground py-1.5">
                      {entry.target_type}
                    </TableCell>
                    <TableCell className="text-sm max-w-[250px] truncate py-1.5">
                      {entry.target_name}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {offset < total && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => load(false, offset)}
                  disabled={loading}
                >
                  {loading && (
                    <Loader2 size={12} className="animate-spin mr-1.5" />
                  )}
                  Load More ({total - offset} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </PanelCard>
    </Section>
  );
}
