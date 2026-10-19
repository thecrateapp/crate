import { LibrarySection } from "@/components/library/LibrarySection";
import { LibraryContributionRow } from "@/components/library/LibraryContributionRow";
import { ContributionArtwork } from "@/components/library/ContributionArtwork";
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
    <LibrarySection title={title} subtitle={description} as="h3">
      <div className="grid gap-3 md:grid-cols-2">
        {contributions.map((contribution) => (
          <LibraryContributionRow
            key={contribution.id}
            title={contribution.album_name}
            artist={contribution.artist_name}
            artwork={<ContributionArtwork contribution={contribution} />}
            exportLabel={exportLabel}
            withdrawLabel={withdrawLabel}
            canExport={Boolean(contribution.album_id)}
            onExport={() => onExport(contribution)}
            onWithdraw={() => onWithdraw(contribution)}
          />
        ))}
      </div>
    </LibrarySection>
  );
}
