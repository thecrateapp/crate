import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import {
  AlertCircle,
  ArrowDownToLine,
  CRATE_ICON_SIZE,
  Loader2,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import {
  useRemoteImport,
  type RemoteImportStatus,
} from "@/hooks/useRemoteImport";
import { formatBytes } from "@/lib/utils";

interface RemoteImportActionProps {
  globalAlbumUid: string;
  estimatedBytes?: number | null;
  sourceName?: string | null;
}

function RemoteImportCompleted() {
  const { t } = useTranslation();
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-accent-action">
      <ArrowDownToLine size={CRATE_ICON_SIZE.sm} />
      {t("album.remoteImport.completed")}
    </p>
  );
}

function RemoteImportApprovalStatus({
  status,
}: {
  status: RemoteImportStatus;
}) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-text-muted" role="status">
      {status === "approved"
        ? t("album.remoteImport.approved")
        : t("album.remoteImport.awaitingApproval")}
    </p>
  );
}

function RemoteImportProgressStatus({
  status,
  progress,
}: {
  status: RemoteImportStatus;
  progress: number | null;
}) {
  const { t } = useTranslation();
  return (
    <p
      className="inline-flex items-center gap-2 text-sm text-text-muted"
      role="status"
    >
      <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
      {status === "downloading" && progress != null
        ? t("album.remoteImport.downloading", { progress })
        : t(`album.remoteImport.${status}`)}
    </p>
  );
}

function terminalMessage(
  status: RemoteImportStatus,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (status === "cancelled") return t("album.remoteImport.cancelled");
  if (status === "offline") return t("album.remoteImport.offline");
  if (status === "forbidden") return t("album.remoteImport.forbidden");
  if (status === "failed" || status === "cleaned") {
    return t("album.remoteImport.failed");
  }
  return null;
}

function RemoteImportTerminalStatus({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
      <span className="inline-flex items-center gap-2 text-text-muted">
        <AlertCircle size={CRATE_ICON_SIZE.sm} /> {message}
      </span>
      <button
        type="button"
        className="link-accent font-semibold"
        onClick={onRetry}
      >
        {t("album.remoteImport.retry")}
      </button>
    </div>
  );
}

function RemoteImportConfirmation({
  open,
  estimatedSize,
  sourceName,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  estimatedSize: string | null;
  sourceName?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={t("album.remoteImport.confirmTitle")}
      description={t("album.remoteImport.confirmBody", {
        source: sourceName || t("album.remoteImport.remoteNode"),
        size: estimatedSize || t("album.remoteImport.unknownSize"),
      })}
      confirmLabel={t("album.remoteImport.confirm")}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      ariaLabel={t("album.remoteImport.confirmTitle")}
      backdropLabel={t("common.close")}
    />
  );
}

function RemoteImportRequestButton({
  requesting,
  onRequest,
}: {
  requesting: boolean;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="secondary"
      shape="pill"
      className="h-11 border border-accent-action/25 bg-accent-action/10 px-5 font-semibold text-accent-action hover:bg-accent-action/15 disabled:cursor-wait disabled:opacity-60 [&_svg:not([class*='size-'])]:size-4 has-[>svg]:px-5"
      disabled={requesting}
      onClick={onRequest}
    >
      {requesting ? (
        <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
      ) : (
        <ArrowDownToLine size={CRATE_ICON_SIZE.sm} />
      )}
      {requesting
        ? t("album.remoteImport.requesting")
        : t("album.remoteImport.action")}
    </Button>
  );
}

export function RemoteImportAction({
  globalAlbumUid,
  estimatedBytes,
  sourceName,
}: RemoteImportActionProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { status, progress, start, reset } = useRemoteImport(globalAlbumUid);
  const estimatedSize =
    estimatedBytes && estimatedBytes > 0 ? formatBytes(estimatedBytes) : null;

  if (status === "completed") return <RemoteImportCompleted />;
  if (["awaiting_approval", "requested", "approved"].includes(status)) {
    return <RemoteImportApprovalStatus status={status} />;
  }
  if (["reserving", "downloading", "verifying", "importing"].includes(status)) {
    return <RemoteImportProgressStatus status={status} progress={progress} />;
  }

  const message = terminalMessage(status, t);
  const confirmation = (
    <RemoteImportConfirmation
      open={confirming}
      estimatedSize={estimatedSize}
      sourceName={sourceName}
      onConfirm={() => {
        setConfirming(false);
        void start();
      }}
      onCancel={() => setConfirming(false)}
    />
  );

  return (
    <>
      {message ? (
        <RemoteImportTerminalStatus
          message={message}
          onRetry={() => {
            reset();
            setConfirming(true);
          }}
        />
      ) : (
        <RemoteImportRequestButton
          requesting={status === "requesting"}
          onRequest={() => setConfirming(true)}
        />
      )}
      {confirmation}
    </>
  );
}
