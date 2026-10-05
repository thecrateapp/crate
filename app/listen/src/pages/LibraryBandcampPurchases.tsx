import { useMemo } from "react";

import { BandcampItem as BandcampItemView } from "@/components/bandcamp/BandcampItem";
import { resolveMaybeApiAssetUrl } from "@/lib/api";

import type { BandcampItem } from "./library-model";

export function LibraryBandcampPurchases({
  purchases,
  busyItemId,
  importedLabel,
  onImport,
}: {
  purchases: BandcampItem[];
  busyItemId: number | null;
  importedLabel: string;
  onImport: (item: BandcampItem) => void;
}) {
  const items = useMemo(
    () =>
      purchases.map((item) => ({
        ...item,
        cover_url: resolveMaybeApiAssetUrl(item.cover_url),
      })),
    [purchases],
  );
  const busyAction = busyItemId == null ? null : `import:${busyItemId}`;

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <BandcampItemView
          key={`${item.id}-${item.item_url}`}
          item={item}
          variant="row"
          busyAction={busyAction}
          canImport={
            item.downloadable === true &&
            item.latest_import_status !== "completed"
          }
          importedLabel={importedLabel}
          onImport={onImport}
        />
      ))}
    </div>
  );
}
