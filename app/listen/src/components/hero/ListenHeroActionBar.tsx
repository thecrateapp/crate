import { useTranslation } from "react-i18next";

import type { ContextMenuMediaImageProps } from "@crate/ui/domain/actions";
import {
  HeroActionBar,
  type HeroActionBarProps,
  type HeroActionMenu,
} from "@crate/ui/domain/hero";

import { CrateImage } from "@/components/artwork/CrateImage";

export type ListenHeroActionMenu = Omit<
  HeroActionMenu,
  "sheetLabel" | "surfaceClassName" | "renderMediaImage"
>;

export interface ListenHeroActionBarProps
  extends Omit<HeroActionBarProps, "menu" | "moreLabel"> {
  menu?: ListenHeroActionMenu;
}

const MENU_SURFACE_CLASS_NAME = "listen-glass-panel";

function renderMediaImage({ src, ...props }: ContextMenuMediaImageProps) {
  return <CrateImage {...props} source={src} />;
}

export function ListenHeroActionBar({
  menu,
  ...props
}: ListenHeroActionBarProps) {
  const { t } = useTranslation();

  return (
    <HeroActionBar
      {...props}
      moreLabel={t("common.more")}
      menu={
        menu
          ? {
              ...menu,
              sheetLabel: t("actions.menu.sheetLabel"),
              surfaceClassName: MENU_SURFACE_CLASS_NAME,
              renderMediaImage,
            }
          : undefined
      }
    />
  );
}
