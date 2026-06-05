import { useEffect, useState } from "react";
import { ArchiveRestore, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { timeAgo } from "@/lib/utils";

interface QuarantinedTrack {
  quarantine_path: string;
  filename: string;
  size_bytes: number;
  modified_at: string;
  suggested_target_path: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumartist?: string | null;
  track_number?: string | null;
  disc_number?: string | null;
  year?: string | null;
  genre?: string | null;
  duration?: number | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
}

interface QuarantineResponse {
  items: QuarantinedTrack[];
  count: number;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[index]
  }`;
}

function formatDuration(seconds?: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function displayTitle(item: QuarantinedTrack) {
  return item.title?.trim() || item.filename;
}

function metadataLine(item: QuarantinedTrack) {
  return [
    item.artist || item.albumartist,
    item.album,
    item.track_number ? `track ${item.track_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function technicalLine(item: QuarantinedTrack) {
  const duration = formatDuration(item.duration);
  const quality = [
    item.bit_depth ? `${item.bit_depth}-bit` : null,
    item.sample_rate ? `${(item.sample_rate / 1000).toFixed(1)} kHz` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  return [
    formatBytes(item.size_bytes),
    duration,
    quality,
    timeAgo(item.modified_at),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function Trash() {
  const [items, setItems] = useState<QuarantinedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuarantinedTrack | null>(
    null,
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const totalSizeBytes = items.reduce(
    (total, item) => total + (Number(item.size_bytes) || 0),
    0,
  );

  async function load() {
    setLoading(true);
    try {
      const payload = await api<QuarantineResponse>(
        "/api/manage/tracks/quarantine",
      );
      setItems(payload.items ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load .crate-trash",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runTrackTask(
    item: QuarantinedTrack,
    endpoint: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusyPath(item.quarantine_path);
    try {
      const { task_id } = await api<{ task_id: string }>(
        endpoint,
        "POST",
        body,
      );
      const task = await waitForTask(task_id, 120000);
      if (task.status === "completed") {
        toast.success(successMessage);
        await load();
      } else {
        toast.error(task.error || "Track operation failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Track operation failed",
      );
    } finally {
      setBusyPath(null);
      setDeleteTarget(null);
    }
  }

  async function restore(item: QuarantinedTrack) {
    await runTrackTask(
      item,
      "/api/manage/tracks/quarantine/restore",
      {
        quarantine_path: item.quarantine_path,
        reason: "Manual restore from .crate-trash",
      },
      "Track restored from .crate-trash",
    );
  }

  async function hardDelete(item: QuarantinedTrack) {
    await runTrackTask(
      item,
      "/api/manage/tracks/quarantine/hard-delete",
      {
        quarantine_path: item.quarantine_path,
        reason: "Manual hard delete from .crate-trash",
      },
      "Quarantined track deleted permanently",
    );
  }

  async function hardDeleteAll() {
    setBulkDeleting(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/manage/tracks/quarantine/hard-delete-all",
        "POST",
        { reason: "Manual empty trash from admin" },
      );
      const task = await waitForTask(task_id, 10 * 60 * 1000);
      if (task.status === "completed") {
        const deleted =
          typeof task.result?.deleted === "number" ? task.result.deleted : null;
        const bytesDeleted =
          typeof task.result?.bytes_deleted === "number"
            ? task.result.bytes_deleted
            : null;
        const suffix =
          deleted !== null
            ? `: ${deleted} tracks${
                bytesDeleted !== null ? `, ${formatBytes(bytesDeleted)}` : ""
              }`
            : "";
        toast.success(`Trash emptied${suffix}`);
        await load();
      } else {
        toast.error(task.error || "Empty trash failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Empty trash failed",
      );
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-card/70 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Trash2 size={22} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Library Trash
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Reversible track quarantine. Files live under .crate-trash until
                restored or deleted permanently.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || bulkDeleting}
              onClick={() => void load()}
            >
              <RefreshCw
                size={15}
                className={loading ? "mr-2 animate-spin" : "mr-2"}
              />
              Refresh
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                loading ||
                items.length === 0 ||
                busyPath !== null ||
                bulkDeleting
              }
              onClick={() => setBulkDeleteOpen(true)}
            >
              {bulkDeleting ? (
                <Loader2 size={15} className="mr-2 animate-spin" />
              ) : (
                <Trash2 size={15} className="mr-2" />
              )}
              Empty trash
            </Button>
          </div>
        </div>
      </section>

      <Card className="border-white/10 bg-card/70">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Loading quarantined tracks...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              .crate-trash is empty
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quarantined tracks will appear here after manual removals or
              repair actions.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {items.map((item) => {
              const busy = busyPath === item.quarantine_path;
              return (
                <div
                  key={item.quarantine_path}
                  className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white/90">
                      {displayTitle(item)}
                    </div>
                    {metadataLine(item) ? (
                      <div className="mt-1 truncate text-xs text-white/55">
                        {metadataLine(item)}
                      </div>
                    ) : null}
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {item.quarantine_path}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-white/40">
                      <span>{technicalLine(item)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyPath !== null || bulkDeleting}
                      onClick={() => void restore(item)}
                    >
                      {busy ? (
                        <Loader2 size={14} className="mr-2 animate-spin" />
                      ) : (
                        <ArchiveRestore size={14} className="mr-2" />
                      )}
                      Restore
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busyPath !== null || bulkDeleting}
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 size={14} className="mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Quarantined Track"
        description={`Permanently delete "${
          deleteTarget ? displayTitle(deleteTarget) : "this track"
        }" from .crate-trash? This cannot be undone.`}
        confirmLabel="Delete Permanently"
        variant="destructive"
        onConfirm={() => deleteTarget && void hardDelete(deleteTarget)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Empty Library Trash"
        description={`Permanently delete ${items.length} quarantined track${
          items.length === 1 ? "" : "s"
        } (${formatBytes(
          totalSizeBytes,
        )}) from .crate-trash? This cannot be undone.`}
        confirmLabel="Empty Trash"
        variant="destructive"
        onConfirm={() => void hardDeleteAll()}
      />
    </div>
  );
}
