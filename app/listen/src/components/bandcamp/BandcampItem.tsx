import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { buildBandcampActions } from "@/components/actions/bandcamp-actions";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";
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
  const getActions = useCallback(
    () =>
      buildBandcampActions(
        {
          canImport,
          importing,
          importDisabled,
          itemUrl: item.item_url,
          onImport: () => latest.current.onImport(latest.current.item),
          onOpen: () =>
            void openExternalUrl(latest.current.item.item_url ?? ""),
        },
        t,
      ),
    [canImport, importDisabled, importing, item.item_url, t],
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
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });

  const menuButton = (
    <ItemActionMenuButton
      buttonRef={controller.triggerRef}
      hasActions={controller.hasActions}
      onClick={controller.openFromTrigger}
      expanded={controller.open}
      title={t("actions.menu.more")}
      className={cn(
        "size-9 rounded-full opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
        tile &&
          "absolute right-2 top-2 z-20 bg-surface-canvas/40 backdrop-blur-md",
      )}
    />
  );

  return (
    <article
      className={cn(
        "item-action-target group relative border border-text-primary/8 bg-surface-canvas/18",
        tile
          ? "overflow-hidden rounded-[12px]"
          : "flex items-center gap-3 rounded-xl p-3",
      )}
      data-variant={variant}
      {...targetProps}
    >
      <BandcampItemCover item={item} compact={!tile} />
      <div className={tile ? "space-y-3 p-4" : "min-w-0 flex-1"}>
        <div className="min-w-0">
          <h3
            className={cn(
              "truncate font-black text-text-primary",
              tile ? "text-base" : "text-sm",
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              "truncate text-text-muted",
              tile ? "text-sm" : "text-xs",
            )}
          >
            {item.artist_name}
          </p>
        </div>
        {tile ? (
          <BandcampItemActions
            item={item}
            busyAction={busyAction}
            onImport={onImport}
            canImport={canImport}
          />
        ) : null}
      </div>
      {!tile && imported && importedLabel ? (
        <span className="rounded-full border border-state-success/25 bg-state-success/10 px-3 py-1 text-xs font-bold text-state-success">
          {importedLabel}
        </span>
      ) : null}
      {!tile ? (
        <BandcampItemActions
          item={item}
          busyAction={busyAction}
          onImport={onImport}
          canImport={canImport}
          compact
        />
      ) : null}
      {menuButton}
      {menu}
    </article>
  );
});
