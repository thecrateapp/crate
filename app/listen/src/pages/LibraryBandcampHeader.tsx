import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";

import { StatBox } from "./LibraryPrimitives";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

export function LibraryBandcampHeader({
  purchases,
  importedCount,
  wishlistCount,
  title,
  description,
  purchasesLabel,
  importedLabel,
  wishlistLabel,
}: {
  purchases: number;
  importedCount: number;
  wishlistCount: number;
  title: string;
  description: string;
  purchasesLabel: string;
  importedLabel: string;
  wishlistLabel: string;
}) {
  return (
    <div className="rounded-panel border border-accent-action/20 bg-accent-action/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CrateBadge size="md" icon={BandcampLogo}>
            Bandcamp
          </CrateBadge>
          <h2 className="mt-3 text-xl font-black text-text-primary">{title}</h2>
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        </div>
        <div className="flex gap-2">
          <StatBox value={purchases} label={purchasesLabel} />
          <StatBox value={importedCount} label={importedLabel} />
          <StatBox value={wishlistCount} label={wishlistLabel} />
        </div>
      </div>
    </div>
  );
}
