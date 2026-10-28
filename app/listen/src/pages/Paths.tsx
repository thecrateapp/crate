import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { notify } from "@crate/ui/lib/notify";
import { PathsPageView } from "./PathsPageView";

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
  const {
    data: paths,
    loading,
    error,
    refetch,
  } = useApi<PathSummary[]>("/api/paths");
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
    <>
      <PathsPageView
        originPanel={
          <EndpointPanel
            side="origin"
            selected={origin}
            onSelect={setOrigin}
            disabled={creating}
          />
        }
        destinationPanel={
          <EndpointPanel
            side="destination"
            selected={destination}
            onSelect={setDestination}
            disabled={creating}
          />
        }
        steps={steps}
        onStepsChange={setSteps}
        creating={creating}
        canCreate={Boolean(canCreate)}
        onCreate={() => void create()}
        loading={loading}
        error={error}
        onRetry={refetch}
        pathCount={paths?.length ?? null}
      >
        {paths?.map((path) => (
          <PathRow
            key={path.id}
            path={path}
            onPlay={() => void playPath(path.id)}
            onDelete={() => setPendingDelete(path)}
          />
        ))}
      </PathsPageView>
      <ConfirmDialog
        eyebrow={t("actions.confirmation.eyebrow")}
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
    </>
  );
}
