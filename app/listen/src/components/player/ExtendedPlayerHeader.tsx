import { EqualizerAnchoredSurface } from "./EqualizerPanelSurface";
import type { TFunction } from "i18next";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { ExtendedPlayerHeaderBar } from "./ExtendedPlayerHeaderBar";
import { VisualizerSettingsPopover } from "./visualizer/VisualizerSettingsPopover";
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
        <VisualizerSettingsPopover
          ref={refs.vizSettingsRef}
          config={state.vizCfg}
        />
      ) : null}
      {showEqualizer ? (
        <EqualizerAnchoredSurface
          ref={refs.equalizerRef}
          label={t("player.equalizer")}
        >
          <EqualizerPanel onClose={() => actions.setShowEqualizer(false)} />
        </EqualizerAnchoredSurface>
      ) : null}
    </>
  );
}
