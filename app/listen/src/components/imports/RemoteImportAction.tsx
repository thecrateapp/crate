import { useState } from "react";
import { useRemoteImport } from "@/hooks/useRemoteImport";
import { formatBytes } from "@/lib/utils";
import { RemoteImportView } from "./RemoteImportView";
export function RemoteImportAction({
  globalAlbumUid,
  estimatedBytes,
  sourceName,
}: {
  globalAlbumUid: string;
  estimatedBytes?: number | null;
  sourceName?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const { status, progress, start, reset } = useRemoteImport(globalAlbumUid);
  return (
    <RemoteImportView
      status={status}
      progress={progress}
      estimatedSize={
        estimatedBytes && estimatedBytes > 0
          ? formatBytes(estimatedBytes)
          : null
      }
      sourceName={sourceName}
      confirming={confirming}
      onRequest={() => setConfirming(true)}
      onCancel={() => setConfirming(false)}
      onRetry={() => {
        reset();
        setConfirming(true);
      }}
      onConfirm={() => {
        setConfirming(false);
        void start();
      }}
    />
  );
}
