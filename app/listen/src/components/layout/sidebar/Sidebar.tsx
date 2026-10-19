import { SidebarView } from "./SidebarView";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { SidebarBrand } from "./SidebarBrand";
import { SidebarNavigation } from "./SidebarNavigation";
import { SIDEBAR_EVENT, SIDEBAR_KEY, getStoredExpanded } from "./sidebar-model";

export function Sidebar() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const navigate = useNavigate();
  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENT, { detail: { expanded: next } }),
    );
  }

  return (
    <SidebarView expanded={expanded}>
      <SidebarBrand
        expanded={expanded}
        onCollapse={toggleExpanded}
        onExpand={() => {
          toggleExpanded();
          navigate("/");
        }}
        collapseLabel={t("nav.sidebar.collapse")}
        expandLabel={t("nav.sidebar.expand")}
      />
      <SidebarNavigation
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
      />
    </SidebarView>
  );
}
