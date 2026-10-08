import type { TFunction } from "i18next";

import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { triggerHaptic } from "@/lib/haptics";

const TABS = [
  { id: "queue", labelKey: "player.queue" },
  { id: "suggested", labelKey: "player.suggested" },
  { id: "lyrics", labelKey: "player.lyrics" },
  { id: "info", labelKey: "player.info" },
] as const;

type ExtendedPlayerTabsProps = {
  actions: ExtendedPlayerViewActions;
  state: ExtendedPlayerViewState;
  t: TFunction;
};

export function ExtendedPlayerTabs({
  actions,
  state,
  t,
}: ExtendedPlayerTabsProps) {
  return (
    <div className="flex w-1/2 flex-col bg-surface-canvas">
      <div className="px-5 pt-5 pb-3">
        <SegmentedControl
          as="tabs"
          variant="tonal"
          label={t("player.tabsLabel")}
          value={state.tab}
          onValueChange={(tab) => {
            triggerHaptic("selection");
            actions.onTabChange(tab);
          }}
          items={TABS.map((item) => ({
            value: item.id,
            label: t(item.labelKey),
          }))}
          className="gap-1.5 p-0"
          itemClassName="h-auto px-3.5 py-1.5 text-[0.75rem] data-[state=active]:bg-surface-control data-[state=active]:text-text-primary data-[state=inactive]:text-text-muted data-[state=inactive]:hover:text-text-secondary"
        />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
        {state.tab === "queue" ? <QueueTab /> : null}
        {state.tab === "suggested" ? <SuggestedTab /> : null}
        {state.tab === "lyrics" ? (
          <LyricsTab useAlbumPalette={state.vizCfg.useAlbumPalette} />
        ) : null}
        {state.tab === "info" ? <InfoTab /> : null}
      </div>
    </div>
  );
}
