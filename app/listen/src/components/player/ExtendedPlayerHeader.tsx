import { AppPopover } from "@crate/ui/primitives/AppPopover";
import type { TFunction } from "i18next";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { ExtendedPlayerHeaderBar } from "./ExtendedPlayerHeaderBar";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewRefs,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";

type ExtendedPlayerHeaderProps = {
  actions: ExtendedPlayerViewActions;
  refs: ExtendedPlayerViewRefs;
  state: ExtendedPlayerViewState;
  t: TFunction;
};

export function ExtendedPlayerHeader({
  actions,
  refs,
  state,
  t,
}: ExtendedPlayerHeaderProps) {
  const showVizSettings =
    state.vizCfg.surfaceMode === "visualizer" && state.showVizSettings;
  const showEqualizer = state.equalizerAvailable && state.showEqualizer;

  return (
    <>
      <ExtendedPlayerHeaderBar
        actions={actions}
        refs={refs}
        state={state}
        t={t}
      />
      {showVizSettings ? (
        <AppPopover
          ref={refs.vizSettingsRef}
          className="absolute top-14 right-4 z-30 w-56 p-4"
        >
          <VisualizerSettingsPanel config={state.vizCfg} />
        </AppPopover>
      ) : null}
      {showEqualizer ? (
        <AppPopover
          ref={refs.equalizerRef}
          className="absolute top-14 right-4 z-30 w-[480px] max-w-[min(480px,calc(100%-2rem))] p-4"
        >
          <EqualizerPanel onClose={() => actions.setShowEqualizer(false)} />
        </AppPopover>
      ) : null}
    </>
  );
}
