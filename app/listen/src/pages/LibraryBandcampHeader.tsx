import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";

import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { LibrarySection } from "../components/library/LibrarySection";

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
    <LibrarySection
      title={title}
      subtitle={description}
      actions={<InfoBadge icon={BandcampLogo}>Bandcamp</InfoBadge>}
    >
      <div className="grid grid-cols-3 gap-4">
        <StatNumber value={purchases} label={purchasesLabel} size="sm" />
        <StatNumber value={importedCount} label={importedLabel} size="sm" />
        <StatNumber value={wishlistCount} label={wishlistLabel} size="sm" />
      </div>
    </LibrarySection>
  );
}
