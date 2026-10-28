import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { MobileNavigationView } from "./ListenNavigation";
import {
  collectionNavigationItems,
  listenNavigationItems,
} from "./listen-navigation-model";
export function MobileBottomNav({
  collectionActive,
  hasTrack,
}: {
  collectionActive: boolean;
  hasTrack: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <MobileNavigationView
      items={listenNavigationItems(t, true)}
      sections={collectionNavigationItems(t, true, location)}
      collectionActive={collectionActive}
      hasTrack={hasTrack}
      collectionLabel={t("nav.collection")}
      closeLabel={t("common.close")}
    />
  );
}
