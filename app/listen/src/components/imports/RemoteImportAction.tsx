import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDownToLine, Loader2 } from "@crate/ui/icons";

import { useRemoteImport } from "@/hooks/useRemoteImport";

interface RemoteImportActionProps {
  globalAlbumUid: string;
  estimatedBytes?: number | null;
  sourceName?: string | null;
}

function formatBytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

export function RemoteImportAction({
  globalAlbumUid,
  estimatedBytes,
  sourceName,
}: RemoteImportActionProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { status, progress, start, reset } = useRemoteImport(globalAlbumUid);
  const estimatedSize = formatBytes(estimatedBytes);

  if (status === "completed") {
    return (
      <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
        <ArrowDownToLine size={16} />
        {t("album.remoteImport.completed")}
      </p>
    );
  }

  if (["awaiting_approval", "requested", "approved"].includes(status)) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {status === "approved"
          ? t("album.remoteImport.approved")
          : t("album.remoteImport.awaitingApproval")}
      </p>
    );
  }

  if (["reserving", "downloading", "verifying", "importing"].includes(status)) {
    return (
      <p
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 size={16} className="animate-spin" />
        {status === "downloading" && progress != null
          ? t("album.remoteImport.downloading", { progress })
          : t(`album.remoteImport.${status}`)}
      </p>
    );
  }

  const terminalMessage =
    status === "cancelled"
      ? t("album.remoteImport.cancelled")
      : status === "offline"
        ? t("album.remoteImport.offline")
        : status === "forbidden"
          ? t("album.remoteImport.forbidden")
          : status === "failed" || status === "cleaned"
            ? t("album.remoteImport.failed")
            : null;

  if (terminalMessage && !confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <AlertCircle size={16} /> {terminalMessage}
        </span>
        <button
          type="button"
          className="font-semibold text-primary hover:text-primary/80"
          onClick={() => {
            reset();
            setConfirming(true);
          }}
        >
          {t("album.remoteImport.retry")}
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div
        className="max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        role="group"
        aria-label={t("album.remoteImport.confirmTitle")}
      >
        <p className="text-sm font-semibold text-foreground">
          {t("album.remoteImport.confirmTitle")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("album.remoteImport.confirmBody", {
            source: sourceName || t("album.remoteImport.remoteNode"),
            size: estimatedSize || t("album.remoteImport.unknownSize"),
          })}
        </p>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => {
              setConfirming(false);
              void start();
            }}
          >
            {t("album.remoteImport.confirm")}
          </button>
          <button
            type="button"
            className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-semibold text-foreground"
            onClick={() => setConfirming(false)}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-wait disabled:opacity-60"
      disabled={status === "requesting"}
      onClick={() => setConfirming(true)}
    >
      {status === "requesting" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <ArrowDownToLine size={16} />
      )}
      {status === "requesting"
        ? t("album.remoteImport.requesting")
        : t("album.remoteImport.action")}
    </button>
  );
}
