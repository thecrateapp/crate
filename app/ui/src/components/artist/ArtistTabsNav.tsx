import type { ReactNode } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import type { TabKey } from "./artistPageTypes";

interface ArtistTabsNavProps {
  tabs: { key: TabKey; label: string }[];
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  children?: ReactNode;
}

export function ArtistTabsNav({
  tabs,
  activeTab,
  onChange,
  children,
}: ArtistTabsNavProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onChange(value as TabKey)}
    >
      <div className="sticky top-[var(--app-header-h,0px)] z-10 bg-surface-canvas">
        <TabsList aria-label="Artist sections">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          {tab.key === activeTab ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
