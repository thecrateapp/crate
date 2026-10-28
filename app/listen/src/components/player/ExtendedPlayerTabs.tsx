import type { TFunction } from "i18next";

import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";
import { PlayerPanels } from "./PlayerPanels";
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
    <div className="flex min-h-0 w-1/2 flex-col bg-surface-canvas pt-5 pb-5">
      <PlayerPanels
        value={state.tab}
        label={t("player.tabsLabel")}
        onValueChange={(tab) => {
          triggerHaptic("selection");
          actions.onTabChange(tab as typeof state.tab);
        }}
        items={TABS.map((item) => ({
          value: item.id,
          label: t(item.labelKey),
          content: (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
              {item.id === "queue" ? (
                <QueueTab />
              ) : item.id === "suggested" ? (
                <SuggestedTab />
              ) : item.id === "lyrics" ? (
                <LyricsTab useAlbumPalette={state.vizCfg.useAlbumPalette} />
              ) : (
                <InfoTab />
              )}
            </div>
          ),
        }))}
      />
    </div>
  );
}
