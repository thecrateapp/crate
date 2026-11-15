import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { FormField } from "@crate/ui/primitives/FormField";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

type StemState = "pending" | "analyzing" | "ready" | "failed";
type Counts = Record<StemState, number>;

interface UserRef {
  id: number;
  username: string | null;
}

export interface AdminSmartMixPlaylist {
  playlistId: number;
  name: string;
  owner: UserRef | null;
  enabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  lastUsedAt: string | null;
  total: number;
  counts: Counts;
  estimatedSecondsLeft: number | null;
  failures: {
    trackId: number;
    title: string | null;
    artist: string | null;
    attempts: number;
    lastError: string | null;
    finishedAt: string | null;
  }[];
  fileBytes: number;
  files: number;
}

export interface StemSettings {
  maxTracksPerPlaylist: number;
  maxTracksPerUser: number | null;
  quotaGib: number;
  uploadsEnabled: boolean;
}

export interface AdminSmartMixPlaylists {
  playlists: AdminSmartMixPlaylist[];
  overview: {
    playlistsOn: number;
    playlistsOff: number;
    tracks: number;
    counts: Counts;
    estimatedSecondsLeft: number | null;
    secondsPerTrack: number;
    serverSeparator: string | null;
    storage: { usedBytes: number; files: number; evictableBytes: number };
    settings: StemSettings;
  };
}

interface PlaylistStatus {
  tracks: {
    trackId: number;
    title: string | null;
    artist: string | null;
    state: StemState;
    attempts: number;
    startedAt: string | null;
    finishedAt: string | null;
    lastError: string | null;
  }[];
}

type Filter = "all" | "on" | "progress" | "failed" | "off";

const GIB = 1024 ** 3;
const MAX_QUOTA_GIB = 100_000;
const STATE_NAMES: Record<StemState, string> = {
  pending: "Pending",
  analyzing: "Separating",
  ready: "Ready",
  failed: "Failed",
};

export function gib(bytes: number) {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/** "≈ 24 min", "≈ 4 h 28 min". */
export function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `≈ ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `≈ ${hours} h ${minutes % 60} min`;
}

function day(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function moment(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function ownerName(owner: UserRef | null) {
  if (!owner) return "—";
  return owner.username ?? `user ${owner.id}`;
}

function inProgress(playlist: AdminSmartMixPlaylist) {
  return (
    playlist.enabled && playlist.counts.pending + playlist.counts.analyzing > 0
  );
}

export function matches(
  playlist: AdminSmartMixPlaylist,
  filter: Filter,
  query: string,
) {
  const wanted =
    filter === "all" ||
    (filter === "on" && playlist.enabled) ||
    (filter === "off" && !playlist.enabled) ||
    (filter === "progress" && inProgress(playlist)) ||
    (filter === "failed" && playlist.enabled && playlist.counts.failed > 0);
  const needle = query.trim().toLocaleLowerCase();
  return (
    wanted &&
    (!needle ||
      playlist.name.toLocaleLowerCase().includes(needle) ||
      ownerName(playlist.owner).toLocaleLowerCase().includes(needle))
  );
}

// SmartMixCoverage's Metric, unchanged.
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border-t border-border-quiet py-3">
      <MonoLabel as="div">{label}</MonoLabel>
      <div className="mt-2 font-mono text-numeral-sm tabular-nums text-text-primary">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

interface SettingsDraft {
  perPlaylist: string;
  perUser: string;
  quota: string;
  uploads: boolean;
}

function draftOf(settings: StemSettings): SettingsDraft {
  return {
    perPlaylist: String(settings.maxTracksPerPlaylist),
    perUser:
      settings.maxTracksPerUser == null
        ? ""
        : String(settings.maxTracksPerUser),
    quota: String(settings.quotaGib),
    uploads: settings.uploadsEnabled,
  };
}

function wholeNumber(
  value: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return number >= min && number <= max ? number : null;
}

/** The stem settings in /api/settings/smart-mix: both limits, the quota and uploads. */
function StemSettingsForm({
  settings,
  editable,
  onSaved,
}: {
  settings: StemSettings;
  editable: boolean;
  onSaved: () => void;
}) {
  const savedKey = JSON.stringify(settings);
  const [draft, setDraft] = useState(() => draftOf(settings));
  const [draftKey, setDraftKey] = useState(savedKey);
  const [saving, setSaving] = useState(false);
  // A change of the saved settings (ours or another admin's) restarts the form.
  if (draftKey !== savedKey) {
    setDraftKey(savedKey);
    setDraft(draftOf(settings));
  }
  const perPlaylist = wholeNumber(draft.perPlaylist, 1);
  const perUser =
    draft.perUser.trim() === "" ? null : wholeNumber(draft.perUser, 1);
  const quota = wholeNumber(draft.quota, 0, MAX_QUOTA_GIB);
  const invalid = {
    perPlaylist: perPlaylist == null,
    perUser: draft.perUser.trim() !== "" && perUser == null,
    quota: quota == null,
  };
  const disabled = !editable || saving;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (invalid.perPlaylist || invalid.perUser || invalid.quota) {
      toast.error("Check the stem settings");
      return;
    }
    setSaving(true);
    try {
      await api("/api/settings/smart-mix", "PUT", {
        stem_max_tracks_per_playlist: perPlaylist,
        stem_max_tracks_per_user: perUser,
        stem_quota_gib: quota,
        stem_uploads_enabled: draft.uploads,
      });
      toast.success("Stem settings saved");
      onSaved();
    } catch {
      toast.error("The stem settings could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-labelledby="smart-mix-stem-settings"
      noValidate
      className="space-y-3"
      onSubmit={(event) => void save(event)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <MonoLabel as="h3" id="smart-mix-stem-settings">
            Stem settings
          </MonoLabel>
          <p className="text-xs text-text-muted">
            Limits count distinct local tracks. Lowering one keeps the playlists
            that are on, but they cannot grow; owners over it get a 409 when
            they turn one on or add tracks.
          </p>
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
        >
          {saving ? "Saving" : "Save stem settings"}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-start gap-4">
        <FormField
          label="Tracks per playlist"
          hint="Always on, at least 1"
          error={invalid.perPlaylist ? "A whole number from 1" : undefined}
        >
          <Input
            type="number"
            min={1}
            value={draft.perPlaylist}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, perPlaylist: event.target.value })
            }
          />
        </FormField>
        <FormField
          label="Tracks per user"
          hint="Across a user's Smart Mix playlists"
          error={
            invalid.perUser ? "Empty, or a whole number from 1" : undefined
          }
        >
          <Input
            type="number"
            min={1}
            placeholder="No limit"
            value={draft.perUser}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, perUser: event.target.value })
            }
          />
        </FormField>
        <FormField
          label="Stem quota (GiB)"
          hint="0 keeps no stem files"
          error={invalid.quota ? "A whole number from 0" : undefined}
        >
          <Input
            type="number"
            min={0}
            max={MAX_QUOTA_GIB}
            value={draft.quota}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, quota: event.target.value })
            }
          />
        </FormField>
        <div data-slot="form-field" className="crate-form-field min-w-0">
          <MonoLabel as="span" id="smart-mix-stem-uploads">
            Crate Decks uploads
          </MonoLabel>
          <div className="flex min-h-9 items-center gap-3">
            <Switch
              checked={draft.uploads}
              disabled={disabled}
              aria-labelledby="smart-mix-stem-uploads"
              onCheckedChange={(checked) =>
                setDraft({ ...draft, uploads: checked })
              }
            />
            <span className="text-sm text-text-primary">
              {draft.uploads ? "On" : "Off"}
            </span>
          </div>
          <p className="m-0 text-xs text-text-muted">
            Users with smart_mix.stems.contribute may upload stem analyses
          </p>
        </div>
      </div>
    </form>
  );
}

function PlaylistRow({
  playlist,
  onTrackStates,
}: {
  playlist: AdminSmartMixPlaylist;
  onTrackStates: () => void;
}) {
  const { counts, total } = playlist;
  const ratio = total ? counts.ready / total : 0;
  const failure = playlist.failures[0];
  return (
    <TableRow>
      <TableCell>
        <div className="max-w-xs truncate text-sm text-text-primary">
          {playlist.name}
        </div>
        <div className="text-xs text-text-muted">
          {ownerName(playlist.owner)} · {total.toLocaleString()} tracks
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <InfoBadge tone={playlist.enabled ? "accent" : "neutral"}>
            {playlist.enabled ? "On" : "Off"}
          </InfoBadge>
        </div>
        <div className="mt-1 text-xs text-text-muted">
          since{" "}
          {day(playlist.enabled ? playlist.enabledAt : playlist.disabledAt)}
        </div>
      </TableCell>
      <TableCell className="min-w-44">
        {playlist.enabled ? (
          <div className="space-y-2">
            <div className="text-xs text-text-secondary tabular-nums">
              {counts.ready.toLocaleString()} / {total.toLocaleString()} ready
            </div>
            <ProgressHairline
              label={`${playlist.name} stems`}
              value={ratio}
              valueText={`${counts.ready} of ${total} tracks have stems`}
            />
          </div>
        ) : (
          <div className="text-xs text-text-muted">
            Analyses kept, files evictable
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="text-xs text-text-muted">
          <div className="flex flex-wrap items-center gap-1">
            {counts.analyzing ? (
              <InfoBadge tone="accent">{counts.analyzing} separating</InfoBadge>
            ) : null}
            {counts.pending ? (
              <InfoBadge>{counts.pending} pending</InfoBadge>
            ) : null}
            {counts.failed ? (
              <InfoBadge tone="warning">{counts.failed} failed</InfoBadge>
            ) : null}
            {!counts.analyzing && !counts.pending && !counts.failed ? (
              <span>{playlist.enabled ? "Done" : "—"}</span>
            ) : null}
          </div>
          {playlist.estimatedSecondsLeft != null ? (
            <div className="mt-1">
              {duration(playlist.estimatedSecondsLeft)} left
            </div>
          ) : null}
          {failure?.lastError ? (
            <p className="mt-1 max-w-sm whitespace-normal wrap-anywhere text-state-warning-text">
              {[failure.title, failure.lastError].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-xs text-text-secondary tabular-nums">
          {gib(playlist.fileBytes)}
        </span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-text-muted">
          {moment(playlist.lastUsedAt)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Track states of ${playlist.name}`}
          onClick={onTrackStates}
        >
          Track states
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** Every track's stem state in one Smart Mix playlist, from its status endpoint. */
function TrackStates({
  playlist,
  onClose,
}: {
  playlist: AdminSmartMixPlaylist;
  onClose: () => void;
}) {
  const { data, loading, error } = useApi<PlaylistStatus>(
    `/api/smart-mix/playlists/${playlist.playlistId}`,
  );
  return (
    <AppModal
      open
      onClose={onClose}
      title={
        <span className="wrap-anywhere">{playlist.name} · Track states</span>
      }
      description={`${ownerName(playlist.owner)} · ${playlist.total.toLocaleString()} tracks`}
      closeLabel="Close track states"
      size="2xl"
    >
      <ModalBody className="min-w-0">
        {loading && !data ? (
          <LoadingState label="Loading track states" />
        ) : error || !data ? (
          <p className="m-0 text-sm text-text-muted">
            The track states are unavailable.
          </p>
        ) : !data.tracks?.length ? (
          <p className="m-0 text-sm text-text-muted">
            {playlist.enabled
              ? "This playlist has no local tracks."
              : "Smart Mix is off for this playlist: its tracks have no stem work."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Track</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tracks.map((track) => (
                <TableRow key={track.trackId}>
                  <TableCell>
                    <div className="max-w-xs truncate text-sm text-text-primary">
                      {track.title ?? `Track ${track.trackId}`}
                    </div>
                    <div className="text-xs text-text-muted">
                      {track.artist ?? "—"}
                    </div>
                    {track.lastError ? (
                      <p className="mt-1 max-w-md whitespace-normal wrap-anywhere text-xs text-state-warning-text">
                        {track.lastError}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <InfoBadge
                      tone={
                        track.state === "failed"
                          ? "warning"
                          : track.state === "analyzing"
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {STATE_NAMES[track.state]}
                    </InfoBadge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs tabular-nums">
                      {track.attempts}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-text-muted">
                      {moment(track.finishedAt)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ModalBody>
    </AppModal>
  );
}

/**
 * The Analysis page's Smart Mix playlists panel (ST2.PR4): every user's Smart Mix
 * playlists with their stem work, the stem files' quota and the stem settings.
 */
export function SmartMixPlaylists() {
  const { hasCapability } = useAuth();
  const { data, loading, error, refetch } = useApi<AdminSmartMixPlaylists>(
    "/api/admin/smart-mix/playlists",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [statesOf, setStatesOf] = useState<AdminSmartMixPlaylist | null>(null);
  const playlists = useMemo(() => data?.playlists ?? [], [data]);
  const shown = useMemo(
    () => playlists.filter((playlist) => matches(playlist, filter, query)),
    [playlists, filter, query],
  );

  const panel = (children: ReactNode) => (
    <OpsPanel
      title="Smart Mix playlists"
      description="Playlists their owners turned on for Smart Mix. The server separates their tracks into stems on the heavy queue, ahead of the backfill, and keeps stem files for Crate Decks within the quota."
    >
      {children}
    </OpsPanel>
  );

  if (!data?.overview) {
    if (loading)
      return panel(<LoadingState label="Loading Smart Mix playlists" />);
    return panel(
      <ErrorState
        message={error ?? "The Smart Mix playlists are unavailable."}
        onRetry={refetch}
      />,
    );
  }
  const { overview } = data;
  const { counts, storage, settings } = overview;
  const ratio = overview.tracks ? counts.ready / overview.tracks : 0;
  const percent = Math.round(ratio * 100);
  const usedGib = storage.usedBytes / GIB;
  const count = (wanted: Filter) =>
    playlists.filter((playlist) => matches(playlist, wanted, "")).length;

  return panel(
    <div className="space-y-6">
      <div className="grid gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <MonoLabel as="span" tone="accent">
                Stem separation
              </MonoLabel>
              <InfoBadge>{percent}% ready</InfoBadge>
              <InfoBadge>
                {overview.playlistsOn} on · {overview.playlistsOff} off
              </InfoBadge>
              {overview.serverSeparator ? (
                <InfoBadge>{overview.serverSeparator}</InfoBadge>
              ) : null}
              {overview.estimatedSecondsLeft != null ? (
                <InfoBadge>
                  {duration(overview.estimatedSecondsLeft)} queued
                </InfoBadge>
              ) : null}
            </div>
            <div className="text-xs text-text-muted">
              {counts.ready.toLocaleString()} of{" "}
              {overview.tracks.toLocaleString()} distinct tracks in Smart Mix
              playlists that are on have a server stem analysis.
            </div>
          </div>
          <ProgressHairline
            label="Smart Mix playlist stems"
            value={ratio}
            valueText={`${percent}% of the tracks have stems`}
          />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-x-4 gap-y-2">
            <Metric label="Playlists on" value={overview.playlistsOn} />
            <Metric label="Tracks" value={overview.tracks} />
            <Metric label="Ready" value={counts.ready} />
            <Metric label="Separating" value={counts.analyzing} />
            <Metric label="Pending" value={counts.pending} />
            <Metric label="Failed" value={counts.failed} />
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <MonoLabel as="span" tone="accent">
              Stem files
            </MonoLabel>
            <div className="text-xs text-text-muted">
              {storage.files.toLocaleString()} files on the music volume, three
              AAC stems each.
            </div>
          </div>
          <Meter
            label="Quota"
            value={usedGib}
            max={settings.quotaGib}
            valueText={`${usedGib.toFixed(1)} of ${settings.quotaGib} GiB`}
          />
          <p className="m-0 text-xs text-text-muted">
            {(storage.evictableBytes / GIB).toFixed(1)} GiB belong only to
            playlists turned off and go first; over the quota, the least
            recently used files follow.
          </p>
        </div>
      </div>

      <StemSettingsForm
        settings={settings}
        editable={hasCapability("settings.manage")}
        onSaved={refetch}
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl
            as="radio"
            label="Smart Mix playlist state"
            value={filter}
            onValueChange={setFilter}
            items={[
              { value: "all", label: `All · ${playlists.length}` },
              { value: "on", label: `On · ${count("on")}` },
              {
                value: "progress",
                label: `In progress · ${count("progress")}`,
              },
              { value: "failed", label: `Failed · ${count("failed")}` },
              { value: "off", label: `Off · ${count("off")}` },
            ]}
          />
          <SearchInput
            label="Search playlists"
            placeholder="Search playlist or owner"
            containerClassName="lg:w-72"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        {shown.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Playlist</TableHead>
                <TableHead>Smart Mix</TableHead>
                <TableHead>Stems</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Last use</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((playlist) => (
                <PlaylistRow
                  key={playlist.playlistId}
                  playlist={playlist}
                  onTrackStates={() => setStatesOf(playlist)}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="m-0 text-sm text-text-muted">
            {playlists.length
              ? "No Smart Mix playlist matches."
              : "No user has turned Smart Mix on for a playlist yet."}
          </p>
        )}
      </div>
      {statesOf ? (
        <TrackStates playlist={statesOf} onClose={() => setStatesOf(null)} />
      ) : null}
    </div>,
  );
}
