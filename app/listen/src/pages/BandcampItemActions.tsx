import { useTranslation } from "react-i18next";
import { BandcampItemActionsView } from "../components/bandcamp/BandcampItemActionsView";
import { notify } from "@crate/ui/lib/notify";
import { openExternalUrl } from "@/lib/external-links";
import {
  canImportBandcampItem,
  itemTitle,
  type BandcampItem,
} from "./bandcamp-model";

export function BandcampItemActions({
  item,
  busyAction,
  onImport,
  canImport = canImportBandcampItem(item),
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  compact?: boolean;
  canImport?: boolean;
}) {
  const { t } = useTranslation();
  const title = itemTitle(item, t("bandcamp.itemFallback"));
  return (
    <BandcampItemActionsView
      title={title}
      canImport={canImport}
      importing={busyAction === `import:${item.id}`}
      importDisabled={busyAction !== null}
      hasUrl={Boolean(item.item_url)}
      onImport={() => onImport(item)}
      onOpen={() =>
        void openExternalUrl(item.item_url ?? "").catch(() =>
          notify.error(t("common.toasts.openExternalFailed")),
        )
      }
    />
  );
}
