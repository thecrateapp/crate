import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanelActivity } from "../components/settings/settings-panel-activity";
import { PageHeader } from "@crate/ui/domain/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";

export const SETTINGS_TABS = [
  "preferences",
  "playback",
  "account",
  "connections",
  "offline",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function SettingsPageView({
  value,
  onValueChange,
  panels,
}: {
  value: SettingsTab;
  onValueChange: (value: string) => void;
  panels: Record<SettingsTab, ReactNode>;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const active = node.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) return;
    const reveal = () => {
      const bounds = node.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      // Reveal URL/history selections and resize changes without vertical page scrolling.
      if (tab.left < bounds.left) node.scrollLeft += tab.left - bounds.left;
      else if (tab.right > bounds.right)
        node.scrollLeft += tab.right - bounds.right;
    };
    reveal();
    const resize =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(reveal) : null;
    resize?.observe(node);
    resize?.observe(active);
    return () => resize?.disconnect();
  }, [value, t]);
  return (
    <div className="grid min-w-0 gap-8">
      <PageHeader
        className="settings-header"
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
      />
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList ref={list} aria-label={t("settings.title")}>
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`settings.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {SETTINGS_TABS.map((tab) => (
          <TabsContent
            key={tab}
            value={tab}
            forceMount
            hidden={value !== tab}
            className={value === tab ? "grid gap-8" : "hidden"}
          >
            <SettingsPanelActivity value={value === tab}>
              {panels[tab]}
            </SettingsPanelActivity>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
