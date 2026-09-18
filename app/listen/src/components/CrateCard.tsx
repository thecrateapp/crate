import { Disc3, Lock, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { CrateSummary } from "@/pages/crates-types";

interface CrateCardProps {
  crate: CrateSummary;
  onOpen: () => void;
}

export function CrateCard({ crate, onOpen }: CrateCardProps) {
  const { t } = useTranslation();
  const firstAlbum = crate.first_album;
  const cover = firstAlbum?.has_cover
    ? albumCoverApiUrl(
        {
          globalAlbumUid: firstAlbum.global_album_uid,
          albumName: firstAlbum.name,
          artistName: firstAlbum.artist_name,
        },
        { size: 256 },
      )
    : null;
  const shared = crate.access === "collaborator";

  return (
    <button
      type="button"
      aria-label={t("library.crates.open", { name: crate.name })}
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-xl border border-border-quiet bg-text-primary/[0.035] p-3 text-left transition-colors hover:bg-text-primary/[0.07]"
    >
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-text-primary/5">
        {cover ? (
          <CrateImage
            src={cover}
            alt={firstAlbum?.name ?? ""}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-accent-action/70">
            <Disc3 size={28} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-text-primary">
          {crate.name}
        </div>
        {crate.description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-text-muted">
            {crate.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
          {shared ? <Users size={13} /> : <Lock size={13} />}
          <span>
            {shared
              ? t("library.crates.sharedWithYou")
              : crate.visibility === "public"
                ? t("library.crates.public")
                : t("library.crates.private")}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t("common.albumCountLabel", { count: crate.album_count })}
          </span>
        </div>
      </div>
    </button>
  );
}
