import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import {
  AlertCircle,
  ArrowDownToLine,
  CRATE_ICON_SIZE,
  Loader2,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import type { RemoteImportStatus } from "../../lib/remote-import-types";
export type { RemoteImportStatus } from "../../lib/remote-import-types";

function RemoteImportCompleted() {
  const { t } = useTranslation();
  return (
    <p
      role="status"
      className="inline-flex items-center gap-2 text-sm font-medium text-accent-action"
    >
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
      <Button variant="ghost" onClick={onRetry}>
        {t("album.remoteImport.retry")}
      </Button>
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
      eyebrow={t("actions.confirmation.eyebrow")}
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
      loading={requesting}
      disabled={requesting}
      onClick={onRequest}
    >
      {!requesting ? <ArrowDownToLine size={CRATE_ICON_SIZE.sm} /> : null}
      {requesting
        ? t("album.remoteImport.requesting")
        : t("album.remoteImport.action")}
    </Button>
  );
}

export function RemoteImportView({
  status,
  progress,
  estimatedSize,
  sourceName,
  confirming,
  onConfirm,
  onCancel,
  onRetry,
  onRequest,
}: {
  status: RemoteImportStatus;
  progress: number | null;
  estimatedSize: string | null;
  sourceName?: string | null;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
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
        onConfirm();
      }}
      onCancel={() => onCancel()}
    />
  );

  return (
    <>
      {message ? (
        <RemoteImportTerminalStatus
          message={message}
          onRetry={() => {
            onRetry();
          }}
        />
      ) : (
        <RemoteImportRequestButton
          requesting={status === "requesting"}
          onRequest={() => onRequest()}
        />
      )}
      {confirmation}
    </>
  );
}
