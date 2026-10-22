import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  OpsPageHero,
  OpsStatTile,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toast } from "sonner";

type ImportStatus = "pending" | "importing" | "imported" | "merged";
type ImportFilter = "pending" | "importing" | "completed" | "all";

interface ImportQueueItem {
  source: string;
  source_path: string;
  artist: string;
  album: string;
  track_count: number;
  formats: string[];
  total_size_mb: number;
  dest_path: string;
  dest_exists: boolean;
  status: ImportStatus;
  dest_album_id?: number | null;
  task_id?: string | null;
  last_error?: string | null;
  discovered_at?: string | null;
  updated_at?: string | null;
}

interface PortableSidecar {
  schema_version: number;
  artist: Record<string, unknown>;
  album: Record<string, unknown>;
  tracks: Record<string, unknown>[];
  portable_metadata: {
    sidecar_path?: string | null;
    sidecar_written_at?: string | null;
    audio_tags_written_at?: string | null;
    tracks: number;
    tags_written: number;
    tag_errors: number;
    export_path?: string | null;
    exported_at?: string | null;
    updated_at?: string | null;
  };
}

interface TaskEnqueueResponse {
  task_id: string;
}

const IMPORT_LIMIT = 1000;
const filters: { value: ImportFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "importing", label: "Importing" },
  { value: "completed", label: "Imported" },
  { value: "all", label: "All" },
];

function itemKey(item: ImportQueueItem) {
  return `${item.source}:${item.source_path}`;
}

function statusTone(status: ImportStatus) {
  if (status === "imported" || status === "merged") return "success" as const;
  if (status === "importing") return "accent" as const;
  return "neutral" as const;
}

function statusLabel(status: ImportStatus) {
  return status.toUpperCase();
}

function displayPathTail(path: unknown, segments = 2) {
  if (typeof path !== "string" || !path.trim()) return "Catalog directory";
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-segments)
    .join("/");
}

function formatSize(sizeMb: number) {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) return "Size unavailable";
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(1)} GB`;
  return `${Math.round(sizeMb)} MB`;
}

function getSafeTaskEventMessage(type: string, data: Record<string, unknown>) {
  if (type === "item" && typeof data.label === "string")
    return `Imported ${data.label}`;
  if (type === "error")
    return "An album could not be imported. It remains available in staging.";
  if (type === "warning")
    return "The import stopped before all albums were processed.";
  if (type === "info" && data.message === "No pending staged imports")
    return "There were no pending albums to import.";
  return null;
}

function JsonPreview({ value }: { value: unknown }) {
  const source = JSON.stringify(value, null, 2);
  const tokenPattern =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|\b(?:true|false|null)\b/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(source))) {
    if (match.index > cursor) parts.push(source.slice(cursor, match.index));
    const token = match[0];
    const isKey =
      token.startsWith('"') &&
      /^\s*:/.test(source.slice(match.index + token.length));
    const tone = isKey
      ? "text-accent-action-hi"
      : token.startsWith('"')
        ? "text-state-success-text"
        : /^(true|false|null)$/.test(token)
          ? "text-state-warning-text"
          : "text-state-info";
    parts.push(
      <span key={`${match.index}:${token}`} className={tone}>
        {token}
      </span>,
    );
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parts.push(source.slice(cursor));
  return (
    <pre
      data-testid="portable-json-viewer"
      className="max-h-[34rem] overflow-auto whitespace-pre rounded-md border border-border-quiet bg-app-surface p-4 font-mono text-xs leading-5 text-text-secondary"
    >
      <code>{parts}</code>
    </pre>
  );
}

function CatalogTree({ sidecar }: { sidecar: PortableSidecar }) {
  const tracks = sidecar.tracks
    .map((track) =>
      String(track.relative_path || track.filename || "").replace(/\\/g, "/"),
    )
    .filter(Boolean);
  const sidecarState = sidecar.portable_metadata.sidecar_written_at
    ? "RECORDED"
    : "NOT RECORDED";

  return (
    <OpsSurface className="grid min-w-0 gap-3 p-5">
      <div>
        <MonoLabel as="h3" tone="accent">
          Catalog file map
        </MonoLabel>
        <p className="mb-0 mt-2 text-xs text-text-muted">
          Expected layout from catalog records; no files are read from the music
          volume.
        </p>
      </div>
      <div
        role="tree"
        aria-label="Catalog file map"
        className="grid gap-1 overflow-x-auto rounded-md border border-border-quiet bg-app-surface p-3 font-mono text-xs text-text-secondary"
      >
        <div
          role="treeitem"
          aria-level={1}
          className="truncate text-text-primary"
        >
          {displayPathTail(sidecar.album.path, 3)}/
        </div>
        <div
          role="group"
          className="ml-4 grid gap-1 border-l border-border-quiet pl-3"
        >
          <div
            role="treeitem"
            aria-level={2}
            className="flex min-w-0 items-center justify-between gap-3"
          >
            <span>.crate/album.json</span>
            <InfoBadge
              tone={sidecarState === "RECORDED" ? "success" : "warning"}
            >
              {sidecarState}
            </InfoBadge>
          </div>
          {sidecar.album.has_cover ? (
            <div role="treeitem" aria-level={2}>
              cover · catalog artwork
            </div>
          ) : null}
          {tracks.map((path, index) => (
            <div
              key={`${index}:${path}`}
              role="treeitem"
              aria-level={2}
              className="truncate"
            >
              {path}
            </div>
          ))}
        </div>
      </div>
    </OpsSurface>
  );
}

function SidecarPanel({
  item,
  sidecar,
  loading,
  error,
}: {
  item: ImportQueueItem | undefined;
  sidecar: PortableSidecar | null;
  loading: boolean;
  error: string | null;
}) {
  if (!item) {
    return (
      <OpsSurface className="p-5">
        <MonoLabel as="h2" tone="accent">
          Portable metadata
        </MonoLabel>
        <p className="mt-3 text-sm text-text-muted">
          Select an imported album to inspect its catalog payload and recorded
          sidecar status.
        </p>
      </OpsSurface>
    );
  }

  if (!item.dest_album_id) {
    return (
      <OpsSurface className="p-5">
        <MonoLabel as="h2" tone="accent">
          Portable metadata
        </MonoLabel>
        <p className="mt-3 text-sm text-text-muted">
          This staged album has no matching library record yet.
        </p>
      </OpsSurface>
    );
  }

  if (loading) {
    return (
      <OpsSurface className="p-5" aria-busy="true">
        <MonoLabel as="h2" tone="accent">
          Portable metadata
        </MonoLabel>
        <p className="mt-3 text-sm text-text-muted">
          Loading catalog metadata…
        </p>
      </OpsSurface>
    );
  }

  if (error || !sidecar) {
    return (
      <OpsSurface className="p-5">
        <MonoLabel as="h2" tone="accent">
          Portable metadata
        </MonoLabel>
        <p className="mt-3 text-sm text-state-warning-text">
          {error || "Portable metadata is unavailable for this album."}
        </p>
      </OpsSurface>
    );
  }

  const metadata = sidecar.portable_metadata;
  const sidecarPayload = {
    schema_version: sidecar.schema_version,
    artist: sidecar.artist,
    album: sidecar.album,
    tracks: sidecar.tracks,
  };
  const jsonText = JSON.stringify(sidecarPayload, null, 2);

  return (
    <div className="grid min-w-0 gap-4">
      <OpsSurface className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <MonoLabel as="h2" tone="accent">
              Album sidecar
            </MonoLabel>
            <p className="mt-2 truncate text-base font-semibold text-text-primary">
              {item.album}
            </p>
            <p className="truncate text-sm text-text-muted">{item.artist}</p>
          </div>
          <InfoBadge tone={metadata.sidecar_written_at ? "success" : "warning"}>
            {metadata.sidecar_written_at ? "SIDECAR RECORDED" : "NOT RECORDED"}
          </InfoBadge>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="crate-form-field">
            <MonoLabel as="span">TRACKS</MonoLabel>
            <span className="text-sm text-text-primary">{metadata.tracks}</span>
          </div>
          <div className="crate-form-field">
            <MonoLabel as="span">TAGS WRITTEN</MonoLabel>
            <span className="text-sm text-text-primary">
              {metadata.tags_written}
            </span>
          </div>
          <div className="crate-form-field">
            <MonoLabel as="span">TAG ERRORS</MonoLabel>
            <span
              className={
                metadata.tag_errors
                  ? "text-sm text-state-warning-text"
                  : "text-sm text-text-primary"
              }
            >
              {metadata.tag_errors}
            </span>
          </div>
        </div>
        <p className="mt-4 font-mono text-xs text-text-muted">
          {metadata.sidecar_path
            ? displayPathTail(metadata.sidecar_path, 4)
            : `${displayPathTail(sidecar.album.path, 3)}/.crate/album.json`}
        </p>
      </OpsSurface>

      <CatalogTree sidecar={sidecar} />

      <OpsSurface className="min-w-0 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <MonoLabel as="h3" tone="accent">
            album.json payload
          </MonoLabel>
          <InfoBadge>{jsonText.split("\n").length} LINES</InfoBadge>
        </div>
        <JsonPreview value={sidecarPayload} />
      </OpsSurface>
    </div>
  );
}

export function Imports() {
  const [items, setItems] = useState<ImportQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ImportFilter>("pending");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [removeCandidate, setRemoveCandidate] =
    useState<ImportQueueItem | null>(null);
  const [sidecar, setSidecar] = useState<PortableSidecar | null>(null);
  const [sidecarLoading, setSidecarLoading] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const handledTaskRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pending, importing, completed] = await Promise.all([
        api<ImportQueueItem[]>(
          `/api/imports/pending?status=pending&limit=${IMPORT_LIMIT}`,
        ),
        api<ImportQueueItem[]>(
          `/api/imports/pending?status=importing&limit=${IMPORT_LIMIT}`,
        ),
        api<ImportQueueItem[]>(
          `/api/imports/pending?status=completed&limit=${IMPORT_LIMIT}`,
        ),
      ]);
      const next = [...pending, ...importing, ...completed];
      setItems(next);
      setSelectedKey((current) => {
        if (current && next.some((item) => itemKey(item) === current))
          return current;
        const firstInspectable = next.find(
          (item) =>
            item.dest_album_id &&
            (item.status === "imported" || item.status === "merged"),
        );
        return firstInspectable ? itemKey(firstInspectable) : "";
      });
    } catch {
      setLoadError(
        "Staged imports could not be loaded. Try again in a moment.",
      );
      toast.error("Could not load staged imports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      pending: items.filter((item) => item.status === "pending").length,
      importing: items.filter((item) => item.status === "importing").length,
      completed: items.filter(
        (item) => item.status === "imported" || item.status === "merged",
      ).length,
    }),
    [items],
  );
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        item.status === filter ||
        (filter === "completed" &&
          (item.status === "imported" || item.status === "merged"));
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return `${item.artist} ${item.album} ${item.source} ${item.source_path}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, items, query]);
  const selectedItem = items.find((item) => itemKey(item) === selectedKey);
  const taskIdFromQueue = items.find(
    (item) => item.status === "importing" && item.task_id,
  )?.task_id;
  const watchedTaskId = activeTaskId || taskIdFromQueue || null;
  const task = useTaskEvents(watchedTaskId);

  useEffect(() => {
    if (!selectedItem?.dest_album_id) {
      setSidecar(null);
      setSidecarError(null);
      setSidecarLoading(false);
      return;
    }
    let cancelled = false;
    setSidecarLoading(true);
    setSidecarError(null);
    api<PortableSidecar>(
      `/api/manage/albums/${selectedItem.dest_album_id}/portable-metadata`,
    )
      .then((payload) => {
        if (!cancelled) setSidecar(payload);
      })
      .catch(() => {
        if (!cancelled)
          setSidecarError("Could not load catalog metadata for this album.");
      })
      .finally(() => {
        if (!cancelled) setSidecarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItem?.dest_album_id]);

  useEffect(() => {
    if (
      !task.done ||
      !watchedTaskId ||
      handledTaskRef.current === watchedTaskId
    )
      return;
    handledTaskRef.current = watchedTaskId;
    setActiveTaskId(null);
    if (task.done.status === "completed") toast.success("Import task finished");
    else toast.warning("Import task finished with items that need attention");
    void load();
  }, [load, task.done, watchedTaskId]);

  async function enqueueImport(item: ImportQueueItem) {
    const key = itemKey(item);
    setBusyKey(key);
    try {
      const result = await api<TaskEnqueueResponse>(
        "/api/imports/import",
        "POST",
        {
          source_path: item.source_path,
          artist: item.artist,
          album: item.album,
        },
      );
      setActiveTaskId(result.task_id);
      handledTaskRef.current = null;
      toast.success(`Import queued for ${item.album}`);
      await load();
    } catch {
      toast.error(`Could not queue ${item.album} for import`);
    } finally {
      setBusyKey(null);
    }
  }

  async function enqueueAll() {
    setBusyAll(true);
    try {
      const result = await api<TaskEnqueueResponse>(
        "/api/imports/import-all",
        "POST",
      );
      setActiveTaskId(result.task_id);
      handledTaskRef.current = null;
      toast.success("All pending imports queued");
      await load();
    } catch {
      toast.error("Could not queue pending imports");
    } finally {
      setBusyAll(false);
    }
  }

  async function removeImport(item: ImportQueueItem) {
    setBusyKey(itemKey(item));
    try {
      const result = await api<TaskEnqueueResponse>(
        "/api/imports/remove",
        "POST",
        {
          source_path: item.source_path,
        },
      );
      setActiveTaskId(result.task_id);
      handledTaskRef.current = null;
      toast.success(`Removal queued for ${item.album}`);
      await load();
    } catch {
      toast.error(`Could not queue removal for ${item.album}`);
    } finally {
      setBusyKey(null);
    }
  }

  const safeEventMessages = task.events
    .map((event) => getSafeTaskEventMessage(event.type, event.data))
    .filter((message): message is string => Boolean(message));

  return (
    <div className="grid min-w-0 content-start gap-6">
      <OpsPageHero
        title="Staged Imports"
        description="Review albums waiting in staging, follow active imports, and inspect portable metadata recorded in the catalog."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh queue
            </Button>
            <Button
              onClick={() => void enqueueAll()}
              loading={busyAll}
              disabled={counts.pending === 0}
            >
              Import all pending
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OpsStatTile
          label="PENDING"
          value={counts.pending}
          caption="Ready to import"
          tone="warning"
        />
        <OpsStatTile
          label="IMPORTING"
          value={counts.importing}
          caption="Worker tasks active"
          tone="primary"
        />
        <OpsStatTile
          label="IMPORTED"
          value={counts.completed}
          caption="With a completed catalog status"
          tone="success"
        />
      </div>

      {watchedTaskId ? (
        <OpsSurface className="grid gap-2 p-4" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonoLabel as="span" tone="accent">
              Import activity
            </MonoLabel>
            <InfoBadge
              tone={
                task.done
                  ? task.done.status === "completed"
                    ? "success"
                    : "warning"
                  : "accent"
              }
            >
              {task.done ? "FINISHED" : task.connected ? "LIVE" : "QUEUED"}
            </InfoBadge>
          </div>
          <p className="m-0 text-sm text-text-primary">
            {safeEventMessages[safeEventMessages.length - 1] ||
              (task.done
                ? "Task finished."
                : "Following the worker task; queue status refreshes when it finishes.")}
          </p>
        </OpsSurface>
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <section
          className="grid min-w-0 content-start gap-4"
          aria-label="Staged import queue"
        >
          <OpsSurface className="grid gap-4 p-4 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <Input
                type="search"
                aria-label="Search staged imports"
                placeholder="Filter by artist, album or source path"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div
                className="flex flex-wrap gap-2"
                aria-label="Import status filter"
              >
                {filters.map((option) => (
                  <FilterChip
                    key={option.value}
                    active={filter === option.value}
                    onClick={() => setFilter(option.value)}
                  >
                    {option.label}
                    {option.value === "pending" ? ` ${counts.pending}` : null}
                    {option.value === "importing"
                      ? ` ${counts.importing}`
                      : null}
                    {option.value === "completed"
                      ? ` ${counts.completed}`
                      : null}
                  </FilterChip>
                ))}
              </div>
            </div>
            {items.length >= IMPORT_LIMIT ? (
              <p className="m-0 text-xs text-text-muted">
                Showing the most recently updated {IMPORT_LIMIT} records per
                status.
              </p>
            ) : null}
          </OpsSurface>

          <OpsSurface className="min-w-0 overflow-hidden">
            {loading ? (
              <div className="p-6 text-sm text-text-muted" role="status">
                Loading staged imports…
              </div>
            ) : loadError ? (
              <div className="grid gap-3 p-6">
                <p className="m-0 text-sm text-state-warning-text">
                  {loadError}
                </p>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => void load()}
                >
                  Try again
                </Button>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="grid gap-2 p-8 text-center">
                <MonoLabel as="span" tone="accent">
                  No staged albums
                </MonoLabel>
                <p className="m-0 text-sm text-text-muted">
                  {query
                    ? "No imports match this filter."
                    : filter === "pending"
                      ? "Everything in staging has been handled."
                      : "There are no albums in this status yet."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border-quiet">
                {visibleItems.map((item) => {
                  const key = itemKey(item);
                  const isSelected = key === selectedKey;
                  const canInspect = Boolean(item.dest_album_id);
                  const cover = item.dest_album_id
                    ? albumCoverApiUrl({
                        albumId: item.dest_album_id,
                        artistName: item.artist,
                        albumName: item.album,
                      })
                    : null;
                  return (
                    <article
                      key={key}
                      data-selected={isSelected || undefined}
                      className="grid min-w-0 gap-3 p-4 data-[selected=true]:bg-accent-action/5 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        disabled={!canInspect}
                        onClick={() => setSelectedKey(key)}
                        className="flex min-w-0 items-start gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-action-hi disabled:cursor-default"
                      >
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border-quiet bg-app-surface">
                          {cover ? (
                            <img
                              src={cover}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="grid min-w-0 gap-1">
                          <span className="truncate text-sm font-semibold text-text-primary">
                            {item.album || "Untitled album"}
                          </span>
                          <span className="truncate text-sm text-text-muted">
                            {item.artist || "Unknown artist"}
                          </span>
                          <span className="truncate font-mono text-xs text-text-subtle">
                            {item.source} · {item.track_count} tracks ·{" "}
                            {formatSize(item.total_size_mb)}
                          </span>
                          <span className="truncate font-mono text-xs text-text-subtle">
                            Source: {displayPathTail(item.source_path)}
                          </span>
                        </div>
                      </button>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <InfoBadge tone={statusTone(item.status)}>
                          {statusLabel(item.status)}
                        </InfoBadge>
                        {item.formats.map((format) => (
                          <InfoBadge key={format}>
                            {format.toUpperCase()}
                          </InfoBadge>
                        ))}
                        {item.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void enqueueImport(item)}
                              loading={busyKey === key}
                            >
                              {item.last_error
                                ? "Retry import"
                                : "Import album"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRemoveCandidate(item)}
                              disabled={Boolean(busyKey)}
                            >
                              Remove
                            </Button>
                          </>
                        ) : null}
                      </div>
                      {item.last_error && item.status === "pending" ? (
                        <p className="m-0 text-xs text-state-warning-text lg:col-span-2">
                          The previous attempt did not finish. You can retry
                          this album.
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </OpsSurface>
        </section>

        <aside className="min-w-0" aria-label="Portable metadata details">
          <SidecarPanel
            item={selectedItem}
            sidecar={sidecar}
            loading={sidecarLoading}
            error={sidecarError}
          />
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(removeCandidate)}
        onOpenChange={(open) => !open && setRemoveCandidate(null)}
        onConfirm={async () => {
          if (removeCandidate) await removeImport(removeCandidate);
        }}
        title="Remove staged album"
        description={
          removeCandidate
            ? `Remove ${removeCandidate.album} by ${removeCandidate.artist} from staging? This does not delete anything from the library.`
            : undefined
        }
        consequence="The staged source directory will be removed by a worker task."
        confirmLabel="Remove from staging"
        variant="destructive"
      />
    </div>
  );
}
