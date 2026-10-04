import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { ArrowRight, CRATE_ICON_SIZE, Loader2, Route } from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PathRow } from "@/components/paths/PathRow";

import { EndpointPanel } from "./PathsParts";
import type { PathDetail, PathSummary, SearchResult } from "./paths-model";

export function Paths() {
  const { t } = useTranslation();
  const { data: paths, refetch } = useApi<PathSummary[]>("/api/paths");
  const { playAll } = usePlayerActions();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<SearchResult | null>(null);
  const [destination, setDestination] = useState<SearchResult | null>(null);
  const [steps, setSteps] = useState(20);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PathSummary | null>(null);

  const canCreate = origin && destination && !creating;

  const create = async () => {
    if (!origin || !destination) return;
    setCreating(true);
    try {
      const result = await api<PathDetail>("/api/paths", "POST", {
        origin: { type: origin.type, value: origin.value },
        destination: { type: destination.type, value: destination.value },
        step_count: steps,
      });
      notify.success(t("paths.toasts.created", { name: result.name }));
      refetch();
      navigate(`/paths/${result.id}`);
    } catch {
      notify.error(t("paths.toasts.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const playPath = async (pathId: number) => {
    try {
      const detail = await api<PathDetail>(`/api/paths/${pathId}`);
      const tracks: Track[] = detail.tracks.map((track) =>
        toPlayableTrack(track, {
          cover:
            track.album_id || track.album_entity_uid
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                    artistEntityUid: track.artist_entity_uid,
                  },
                  { size: 512 },
                )
              : undefined,
        }),
      );
      playAll(tracks, 0, {
        type: "playlist",
        name: detail.name,
        id: detail.id,
      });
    } catch {
      notify.error(t("paths.toasts.loadFailed"));
    }
  };

  const deletePath = async (pathId: number) => {
    try {
      await api(`/api/paths/${pathId}`, "DELETE");
      notify.success(t("paths.toasts.deleted"));
      refetch();
    } catch {
      notify.error(t("paths.toasts.deleteFailed"));
    }
  };

  return (
    <div className="animate-page-in space-y-6 sm:py-6">
      <div className="flex items-center gap-3">
        <Route size={22} className="text-accent-action" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("paths.title")}
          </h1>
          <p className="text-[0.8125rem] text-text-primary/40">
            {t("paths.subtitle")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <EndpointPanel side="origin" selected={origin} onSelect={setOrigin} />
        <div className="flex items-center justify-center sm:py-8">
          <ArrowRight
            size={20}
            className="rotate-90 text-accent-action/40 sm:rotate-0"
          />
        </div>
        <EndpointPanel
          side="destination"
          selected={destination}
          onSelect={setDestination}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-primary/35">
            {t("paths.length")}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label={t("paths.length")}
              min={5}
              max={50}
              value={steps}
              onChange={(event) => setSteps(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-16 text-right font-mono text-[0.75rem] tabular-nums text-text-primary/50">
              {t("common.trackCountLabel", { count: steps })}
            </span>
          </div>
        </div>
        <Button
          onClick={create}
          disabled={!canCreate}
          className="h-auto rounded-lg px-6 py-3 font-semibold shadow-accent-action hover:bg-accent-action/90 disabled:opacity-25 disabled:shadow-none [&_svg:not([class*='size-'])]:size-4 has-[>svg]:px-6"
        >
          {creating ? (
            <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
          ) : (
            <Route size={CRATE_ICON_SIZE.sm} />
          )}
          {t("paths.compute")}
        </Button>
      </div>

      {paths && paths.length > 0 ? (
        <div className="space-y-2 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-primary/30">
            {t("paths.saved")}
          </div>
          {paths.map((path) => (
            <PathRow
              key={path.id}
              path={path}
              onPlay={() => void playPath(path.id)}
              onDelete={() => setPendingDelete(path)}
            />
          ))}
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (pendingDelete) await deletePath(pendingDelete.id);
        }}
        tone="danger"
        title={t("paths.delete.confirmTitle")}
        description={
          pendingDelete
            ? t("paths.delete.confirmDescription", { name: pendingDelete.name })
            : undefined
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("paths.delete.confirmTitle")}
        backdropLabel={t("common.close")}
      />
    </div>
  );
}
