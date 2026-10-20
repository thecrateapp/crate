import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { notify } from "@crate/ui/lib/notify";
import { BandcampItemView } from "./BandcampItemView";
import { buildBandcampActions } from "@/components/actions/bandcamp-actions";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { openExternalUrl } from "@/lib/external-links";
import { BandcampItemActions } from "@/pages/BandcampItemActions";
import { BandcampItemCover } from "@/pages/BandcampItemCover";
import {
  canImportBandcampItem,
  itemTitle,
  type BandcampItem as BandcampItemData,
} from "@/pages/bandcamp-model";

export type BandcampItemVariant = "tile" | "row";

interface BandcampItemProps {
  item: BandcampItemData;
  variant: BandcampItemVariant;
  busyAction: string | null;
  onImport: (item: BandcampItemData) => void;
  canImport?: boolean;
  importedLabel?: string;
}

export const BandcampItem = memo(function BandcampItem({
  item,
  variant,
  busyAction,
  onImport,
  canImport = canImportBandcampItem(item),
  importedLabel,
}: BandcampItemProps) {
  const { t } = useTranslation();
  const title = itemTitle(item, t("bandcamp.itemFallback"));
  const tile = variant === "tile";
  const imported = item.latest_import_status === "completed";

  const latest = useRef({ item, onImport });
  useEffect(() => {
    latest.current = { item, onImport };
  });
  const importing = busyAction === `import:${item.id}`;
  const importDisabled = busyAction !== null;
  const handleOpen = useCallback(() => {
    const url = latest.current.item.item_url;
    if (!url) return;
    void openExternalUrl(url).catch(() =>
      notify.error(t("common.toasts.openExternalFailed")),
    );
  }, [t]);
  const getActions = useCallback(
    () =>
      buildBandcampActions(
        {
          canImport,
          importing,
          importDisabled,
          itemUrl: item.item_url,
          onImport: () => latest.current.onImport(latest.current.item),
          onOpen: handleOpen,
        },
        t,
      ),
    [canImport, importDisabled, importing, item.item_url, handleOpen, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title,
      subtitle: item.artist_name ?? undefined,
      imageUrl: item.cover_url ?? null,
      imageAlt: title,
      imageShape: "square",
    }),
    [item.artist_name, item.cover_url, title],
  );
  const hasMenuActions = canImport || Boolean(item.item_url);
  const actionMenu = useListenEntityMenu(
    hasMenuActions ? getActions : null,
    header,
  );
  return (
    <BandcampItemView
      variant={variant}
      title={title}
      artist={item.artist_name}
      artwork={<BandcampItemCover item={item} compact={!tile} />}
      actions={
        !tile ? (
          <BandcampItemActions
            item={item}
            busyAction={busyAction}
            onImport={onImport}
            canImport={canImport}
            compact={!tile}
          />
        ) : undefined
      }
      importedLabel={imported ? importedLabel : undefined}
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
      onOpen={tile && item.item_url ? handleOpen : undefined}
    />
  );
});
