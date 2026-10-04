import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  ContextMenuHeader,
  ContextMenuMediaImageProps,
  ItemActionMenuEntry,
} from "@crate/ui/domain/actions";
import type { EntityActionMenu } from "@crate/ui/domain/entity";

import { CrateImage } from "@/components/artwork/CrateImage";

export function renderListenMenuImage({
  src,
  ...props
}: ContextMenuMediaImageProps) {
  return <CrateImage {...props} source={src} />;
}

export function useListenEntityMenu(
  getActions: (() => ItemActionMenuEntry[]) | null | undefined,
  header?: ContextMenuHeader,
): EntityActionMenu | undefined {
  const { t } = useTranslation();
  const sheetLabel = t("actions.menu.sheetLabel");

  return useMemo(
    () =>
      getActions
        ? {
            getActions,
            header,
            sheetLabel,
            renderMediaImage: renderListenMenuImage,
          }
        : undefined,
    [getActions, header, sheetLabel],
  );
}
