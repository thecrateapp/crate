import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { SidebarNavigationView } from "../ListenNavigation";
import {
  collectionNavigationItems,
  listenNavigationItems,
} from "../listen-navigation-model";
export function SidebarNavigation({
  expanded,
  onToggleExpanded,
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <SidebarNavigationView
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      items={listenNavigationItems(t, false)}
      sections={collectionNavigationItems(t, false, location)}
      collectionLabel={t("nav.collection")}
      expandLabel={t("nav.sidebar.expand")}
      collectionActive={
        location.pathname === "/library" ||
        location.pathname.startsWith("/collection") ||
        location.pathname === "/bandcamp"
      }
    />
  );
}
