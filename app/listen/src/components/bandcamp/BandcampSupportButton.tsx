import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { api } from "@/lib/api";

interface BandcampLinkState {
  entity_type?: string;
  entity_uid?: string;
  bandcamp_item_id?: number;
  item_url?: string | null;
  artist_url?: string | null;
  album_url?: string | null;
  user_owned?: boolean | null;
  user_downloadable?: boolean | null;
  latest_import_status?: string | null;
}

interface BandcampSupportButtonProps {
  entityType: "artist" | "album";
  entityUid?: string | null;
  artistName?: string;
  className?: string;
}

export function BandcampSupportButton({
  entityType,
  entityUid,
  artistName,
  className = "",
}: BandcampSupportButtonProps) {
  const [link, setLink] = useState<BandcampLinkState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entityUid) {
      setLink(null);
      return;
    }
    api<BandcampLinkState>(
      `/api/bandcamp/links/${entityType}/by-entity/${entityUid}`,
    )
      .then((payload) => {
        const url = payload.item_url || payload.album_url || payload.artist_url;
        setLink(url ? payload : null);
      })
      .catch(() => setLink(null));
  }, [entityType, entityUid]);

  if (!link) return null;

  const url = link.item_url || link.album_url || link.artist_url || "";
  const canImport =
    entityType === "album" &&
    link.bandcamp_item_id &&
    link.user_owned &&
    link.user_downloadable &&
    link.latest_import_status !== "completed";
  const label =
    entityType === "artist"
      ? `Support ${artistName || "artist"}`
      : canImport
        ? "Import from Bandcamp"
        : link.user_owned
          ? "Open on Bandcamp"
          : "Buy this album";

  const handleClick = async () => {
    if (canImport && link.bandcamp_item_id) {
      setBusy(true);
      try {
        const result = await api<{ task_id: string }>(
          "/api/bandcamp/me/imports",
          "POST",
          { bandcamp_item_id: link.bandcamp_item_id, format: "flac" },
        );
        toast.success(`Bandcamp import queued (${result.task_id})`);
      } catch (error) {
        toast.error(
          (error as Error).message || "Failed to import from Bandcamp",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex h-10 items-center gap-2 rounded-full border border-[#1da0c3]/30 bg-[#1da0c3]/10 px-4 text-sm font-medium text-[#7ee7ff] transition-colors hover:bg-[#1da0c3]/15 disabled:opacity-50 ${className}`}
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <BandcampLogo size={15} />
      )}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">Bandcamp</span>
    </button>
  );
}
