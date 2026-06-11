import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { api } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";

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
  fallbackArtistEntityUid?: string | null;
  className?: string;
  iconOnly?: boolean;
}

interface ResolvedBandcampLink {
  entityType: "artist" | "album";
  link: BandcampLinkState;
}

function linkUrlForType(
  entityType: "artist" | "album",
  link: BandcampLinkState,
) {
  return entityType === "artist"
    ? link.artist_url || link.item_url || ""
    : link.album_url || link.item_url || "";
}

async function fetchBandcampLink(
  entityType: "artist" | "album",
  entityUid: string,
) {
  const payload = await api<BandcampLinkState>(
    `/api/bandcamp/links/${entityType}/by-entity/${entityUid}`,
  );
  return linkUrlForType(entityType, payload) ? payload : null;
}

export function BandcampSupportButton({
  entityType,
  entityUid,
  fallbackArtistEntityUid,
  className = "",
  iconOnly = false,
}: BandcampSupportButtonProps) {
  const [resolved, setResolved] = useState<ResolvedBandcampLink | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entityUid && !(entityType === "album" && fallbackArtistEntityUid)) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const primary = entityUid
          ? await fetchBandcampLink(entityType, entityUid)
          : null;
        if (cancelled) return;
        if (primary) {
          setResolved({ entityType, link: primary });
          return;
        }

        if (entityType === "album" && fallbackArtistEntityUid) {
          const fallback = await fetchBandcampLink(
            "artist",
            fallbackArtistEntityUid,
          );
          if (!cancelled)
            setResolved(
              fallback ? { entityType: "artist", link: fallback } : null,
            );
          return;
        }

        setResolved(null);
      } catch {
        if (!cancelled) setResolved(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityUid, fallbackArtistEntityUid]);

  const link = resolved?.link;
  if (!link) return null;

  const resolvedEntityType = resolved.entityType;
  const url = linkUrlForType(resolvedEntityType, link);
  if (!url) return null;
  const latestImportStatus = link.latest_import_status || "";
  const importInProgress = ["queued", "downloading", "importing"].includes(
    latestImportStatus,
  );
  const ownedAlbum = resolvedEntityType === "album" && Boolean(link.user_owned);
  const canImport =
    ownedAlbum &&
    link.bandcamp_item_id &&
    link.user_downloadable &&
    latestImportStatus !== "completed" &&
    !importInProgress;
  const ownedLabel = importInProgress
    ? "Importing from Bandcamp"
    : "Owned on Bandcamp";
  const label =
    resolvedEntityType === "artist"
      ? "Support on Bandcamp"
      : canImport
        ? "Import from Bandcamp"
        : "Buy this album on Bandcamp";

  if (ownedAlbum && !canImport) {
    return (
      <span
        className={`inline-flex h-10 items-center rounded-full border border-[#1da0c3]/25 bg-[#1da0c3]/10 text-sm font-medium text-[#7ee7ff]/90 ${
          iconOnly ? "w-10 justify-center px-0" : "gap-2 px-4"
        } ${className}`}
        aria-label={ownedLabel}
      >
        <BandcampLogo size={15} />
        {iconOnly ? (
          <span className="sr-only">{ownedLabel}</span>
        ) : (
          <>
            <span className="hidden sm:inline">{ownedLabel}</span>
            <span className="sm:hidden">Owned</span>
          </>
        )}
      </span>
    );
  }

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
    await openExternalUrl(url);
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex h-10 items-center ${
        iconOnly ? "w-10 justify-center px-0" : "gap-2 px-4"
      } rounded-full border border-[#1da0c3]/30 bg-[#1da0c3]/10 text-sm font-medium text-[#7ee7ff] transition-colors hover:bg-[#1da0c3]/15 disabled:opacity-50 ${className}`}
      aria-label={ownedAlbum && !canImport ? ownedLabel : label}
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <BandcampLogo size={15} />
      )}
      {iconOnly ? (
        <span className="sr-only">
          {ownedAlbum && !canImport ? ownedLabel : label}
        </span>
      ) : (
        <>
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">Bandcamp</span>
        </>
      )}
    </button>
  );
}
