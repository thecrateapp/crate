import { AppPopover } from "@crate/ui/primitives/AppPopover";
import {
  ChevronDown,
  CRATE_ICON_SIZE,
  Settings,
  SlidersHorizontal,
} from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { TFunction } from "i18next";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { PlayerSurfaceModeSwitch } from "@/components/player/PlayerSurfaceModeSwitch";
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
  const showEqualizer = state.equalizerEnabled && state.showEqualizer;

  return (
    <>
      <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
        <ActionButton
          onClick={actions.closeWithFeedback}
          label={t("player.close")}
        >
          <ChevronDown size={CRATE_ICON_SIZE.lg} />
        </ActionButton>
        <MonoLabel>{t("player.queue.nowPlaying")}</MonoLabel>
        <div className="flex items-center gap-2">
          <PlayerSurfaceModeSwitch
            allowVisualizer={state.visualizerAllowed}
            mode={state.vizCfg.surfaceMode}
            onChange={actions.onSurfaceModeChange}
          />
          {state.equalizerEnabled ? (
            <ActionButton
              ref={refs.equalizerButtonRef}
              onClick={() => {
                actions.setShowVizSettings(false);
                actions.setShowEqualizer((value) => !value);
              }}
              label={t("player.equalizer")}
              aria-pressed={state.showEqualizer}
            >
              <SlidersHorizontal size={CRATE_ICON_SIZE.md} />
            </ActionButton>
          ) : null}
          {state.visualizerAllowed ? (
            <ActionButton
              ref={refs.vizSettingsButtonRef}
              onClick={() => actions.setShowVizSettings((value) => !value)}
              label={t("player.visualizerSettings")}
              aria-pressed={state.showVizSettings}
              disabled={state.vizCfg.surfaceMode !== "visualizer"}
            >
              <Settings size={CRATE_ICON_SIZE.md} />
            </ActionButton>
          ) : null}
        </div>
      </div>
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
