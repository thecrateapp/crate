import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { BackLink } from "@crate/ui/domain/navigation";
import { ErrorState } from "@crate/ui/domain/states";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { CRATE_ICON_SIZE, Loader2, RefreshCw, Trash2 } from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PathRouteVisualization, PathTrackList } from "./PathDetailParts";
import type { PathDetail as PathData, PathTrack } from "./paths-model";

const PILL_ACTION_CLASS_NAME =
  "h-auto gap-1.5 border border-border-quiet bg-text-primary/5 px-3 py-1.5 has-[>svg]:px-3 text-xs text-text-primary/60 hover:bg-text-primary/5 hover:text-text-primary [&_svg:not([class*='size-'])]:size-3";

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
  const [animate, setAnimate] = useState(true);
  const activeTrackRef = useRef<HTMLDivElement>(null);

  const activeStep =
    path?.tracks.findIndex(
      (track) => currentTrack?.libraryTrackId === track.track_id,
    ) ?? -1;

  const playFromStep = useCallback(
    (startIndex: number) => {
      if (!path) return;
      playAll(path.tracks.map(mapToPlayerTrack), startIndex, {
        type: "playlist",
        name: path.name,
        id: path.id,
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

  useEffect(() => {
    activeTrackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeStep]);

  useEffect(() => {
    setAnimate(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
  }, []);

  if (!path) {
    if (loading) {
      return <CrateLoader label={t("paths.loadingDetail")} />;
    }
    const notFound = status === 404 || !error;
    return (
      <div className="animate-page-in px-4 sm:p-6">
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
    <div className="animate-page-in px-4  sm:p-6">
      <BackLink to="/paths" label={t("paths.back")} className="mb-5" />

      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{path.name}</h1>
          <div className="mt-1.5 flex items-center gap-2 text-[0.75rem] text-text-primary/40">
            <span className="font-medium text-accent-action/70">
              {path.origin.label}
            </span>
            <span className="text-text-primary/15">→</span>
            <span className="font-medium text-accent-action/70">
              {path.destination.label}
            </span>
            <span className="text-text-primary/15">·</span>
            <span>
              {t("common.trackCountLabel", { count: path.tracks.length })}
            </span>
          </div>
        </div>
        <PlayButton
          size="md"
          label={t("player.play")}
          onClick={() => playFromStep(0)}
          className="shadow-accent-action-strong hover:bg-accent-action/90"
        />
      </div>

      <PathRouteVisualization
        path={path}
        activeStep={activeStep}
        animate={animate}
        onPlayFromStep={playFromStep}
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="ghost"
          shape="pill"
          onClick={() => void regenerate()}
          disabled={regenerating}
          className={`${PILL_ACTION_CLASS_NAME} hover:border-text-primary/20 disabled:opacity-30`}
        >
          {regenerating ? (
            <Loader2 size={CRATE_ICON_SIZE.micro} className="animate-spin" />
          ) : (
            <RefreshCw size={CRATE_ICON_SIZE.micro} />
          )}
          {t("paths.regenerate")}
        </Button>
        <Button
          variant="ghost"
          shape="pill"
          onClick={() => setConfirmingDelete(true)}
          className={`${PILL_ACTION_CLASS_NAME} hover:border-state-danger/30 hover:text-state-danger-text`}
        >
          <Trash2 size={CRATE_ICON_SIZE.micro} /> {t("common.delete")}
        </Button>
      </div>

      <ConfirmDialog
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

      <PathTrackList
        path={path}
        activeStep={activeStep}
        activeTrackRef={activeTrackRef}
      />
    </div>
  );
}
