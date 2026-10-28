import { useState } from "react";
import { Download } from "@crate/ui/icons";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { api } from "@/lib/api";
import { tidalDownloadMissingArtistApiPath } from "@/lib/library-routes";
import { toast } from "sonner";

interface TidalAlbumCardProps {
  artist: string;
  artistId: number;
  artistEntityUid?: string;
  title: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
}

export function TidalAlbumCard({
  artistId,
  artistEntityUid,
  title,
  year,
  tracks,
  cover,
  url,
}: TidalAlbumCardProps) {
  const [status, setStatus] = useState<"idle" | "downloading" | "queued">(
    "idle",
  );

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (status !== "idle") return;
    setStatus("downloading");
    try {
      await api(
        tidalDownloadMissingArtistApiPath({ artistId, artistEntityUid }),
        "POST",
        {
          albums: [{ url, title, cover_url: cover }],
        },
      );
      setStatus("queued");
      toast.success(`Queued: ${title}`);
    } catch {
      setStatus("idle");
      toast.error(`Failed to queue ${title}`);
    }
  }

  return (
    <div className="relative min-w-0">
      <EntityCard
        title={title}
        subtitle={`${year || "Year unknown"} · ${tracks} tracks`}
        layout="grid"
        menuButton="none"
        cover={{ src: cover, alt: title }}
        meta={
          <span className="flex gap-2">
            <InfoBadge>Tidal</InfoBadge>
            {status === "queued" ? (
              <InfoBadge tone="success">Queued</InfoBadge>
            ) : null}
          </span>
        }
      />
      <div className="absolute top-3 right-3">
        <ActionButton
          label={`Download ${title}`}
          loading={status === "downloading"}
          disabled={status !== "idle"}
          onClick={handleDownload}
        >
          <Download data-admin-ux="album-acquire-tidal" aria-hidden="true" />
        </ActionButton>
      </div>
    </div>
  );
}
