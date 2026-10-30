import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { BackLink } from "@crate/ui/domain/navigation";
import { ErrorState } from "@crate/ui/domain/states";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { notify } from "@crate/ui/lib/notify";
import { PathCoverJourney } from "@/components/paths/PathCoverJourney";
import { PathDetailHeaderView } from "./PathDetailHeaderView";
import { usePlayerState } from "@/contexts/PlayerContext";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PathTrackList } from "./PathDetailParts";
import type { PathDetail as PathData, PathTrack } from "./paths-model";

function mapToPlayerTrack(track: PathTrack): Track {
  return toPlayableTrack(track, {
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
  });
}

export function PathDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    data: path,
    loading,
    error,
    status,
    refetch,
  } = useApi<PathData>(`/api/paths/${id}`);
  const { playAll, currentTrack } = usePlayerActions();
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { isPlaying } = usePlayerState();

  const activeStep =
    path?.tracks.findIndex(
      (track) => currentTrack?.libraryTrackId === track.track_id,
    ) ?? -1;

  const playFromStep = useCallback(
    (startIndex: number) => {
      if (!path) return;
      playAll(path.tracks.map(mapToPlayerTrack), startIndex, {
        type: "queue",
        name: path.name,
        href: `/paths/${path.id}`,
      });
    },
    [path, playAll],
  );

  const regenerate = async () => {
    if (!path || regenerating) return;
    setRegenerating(true);
    try {
      await api(`/api/paths/${path.id}/regenerate`, "POST");
      notify.success(t("paths.toasts.regenerated"));
      refetch();
    } catch {
      notify.error(t("paths.toasts.regenerateFailed"));
    } finally {
      setRegenerating(false);
    }
  };

  if (!path) {
    if (loading) {
      return <CrateLoader label={t("paths.loadingDetail")} />;
    }
    const notFound = status === 404 || !error;
    return (
      <div className="animate-page-in sm:py-6">
        <BackLink to="/paths" label={t("paths.back")} className="mb-5" />
        <ErrorState
          kind={notFound ? "notFound" : "error"}
          message={t(notFound ? "paths.notFound" : "paths.toasts.loadFailed")}
          onRetry={notFound ? undefined : refetch}
          retryLabel={t("common.retry")}
        />
      </div>
    );
  }

  return (
    <div className="animate-page-in sm:py-6">
      <div className="mb-6">
        <PathDetailHeaderView
          name={path.name}
          origin={path.origin.label}
          destination={path.destination.label}
          count={path.tracks.length}
          regenerating={regenerating}
          onPlay={() => playFromStep(0)}
          onRegenerate={() => void regenerate()}
          onDelete={() => setConfirmingDelete(true)}
        />
      </div>
      <div className="mb-6">
        <PathCoverJourney
          key={path.id}
          path={path}
          activeStep={activeStep}
          currentTrackKey={
            currentTrack
              ? String(
                  currentTrack.libraryTrackId ??
                    currentTrack.entityUid ??
                    currentTrack.id,
                )
              : undefined
          }
          playing={isPlaying}
          onPlay={playFromStep}
        />
      </div>
      <ConfirmDialog
        eyebrow={t("actions.confirmation.eyebrow")}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={async () => {
          await api(`/api/paths/${path.id}`, "DELETE");
          notify.success(t("paths.toasts.deleted"));
          navigate("/paths");
        }}
        onError={() => notify.error(t("paths.toasts.deleteFailed"))}
        tone="danger"
        title={t("paths.delete.confirmTitle")}
        description={t("paths.delete.confirmDescription", { name: path.name })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        ariaLabel={t("paths.delete.confirmTitle")}
        backdropLabel={t("common.close")}
      />

      <PathTrackList path={path} />
    </div>
  );
}
