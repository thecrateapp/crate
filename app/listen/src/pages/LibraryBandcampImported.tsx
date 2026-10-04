import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { CRATE_ICON_SIZE, Download, Trash2 } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";

import {
  CONTRIBUTION_EXPORT_CLASS_NAME,
  CONTRIBUTION_WITHDRAW_CLASS_NAME,
} from "./LibraryPrimitives";

import type { LibraryContribution } from "./library-model";

export function LibraryBandcampImported({
  contributions,
  title,
  description,
  exportLabel,
  withdrawLabel,
  onExport,
  onWithdraw,
}: {
  contributions: LibraryContribution[];
  title: string;
  description: string;
  exportLabel: string;
  withdrawLabel: string;
  onExport: (contribution: LibraryContribution) => void;
  onWithdraw: (contribution: LibraryContribution) => void;
}) {
  if (!contributions.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-black uppercase tracking-eyebrow text-accent-action">
          {title}
        </h3>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {contributions.map((contribution) => (
          <article
            key={contribution.id}
            className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-text-primary/[0.03] p-3"
          >
            <div className=" size-14 shrink-0 overflow-hidden rounded-xl border border-text-primary/8 bg-text-primary/6">
              {contribution.album_id ? (
                <CrateImage
                  src={albumCoverApiUrl(
                    {
                      albumId: contribution.album_id,
                      albumEntityUid: contribution.album_entity_uid,
                      artistName: contribution.artist_name,
                      albumName: contribution.album_name,
                    },
                    { size: 128 },
                  )}
                  alt=""
                  loading="lazy"
                  className=" size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <BandcampLogo size={20} className="text-accent-action/70" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-black text-text-primary">
                {contribution.album_name}
              </h4>
              <p className="truncate text-xs text-text-muted">
                {contribution.artist_name}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              shape="pill"
              disabled={!contribution.album_id}
              onClick={() => onExport(contribution)}
              className={CONTRIBUTION_EXPORT_CLASS_NAME}
            >
              <Download size={CRATE_ICON_SIZE.xs} />
              {exportLabel}
            </Button>
            <IconButton
              label={withdrawLabel}
              tone="danger"
              size="sm"
              onClick={() => onWithdraw(contribution)}
              className={CONTRIBUTION_WITHDRAW_CLASS_NAME}
            >
              <Trash2 size={CRATE_ICON_SIZE.xs} />
            </IconButton>
          </article>
        ))}
      </div>
    </section>
  );
}
