import { AppPopover } from "@crate/ui/primitives/AppPopover";
import {
  ChevronDown,
  CRATE_ICON_SIZE,
  Settings,
  SlidersHorizontal,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { IconButton } from "@crate/ui/primitives/IconButton";
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
        <IconButton
          onClick={actions.closeWithFeedback}
          label={t("player.close")}
          className="size-9 bg-surface-control text-text-secondary backdrop-blur-sm hover:translate-y-0 hover:drop-shadow-none hover:bg-surface-control-hover hover:text-text-primary"
        >
          <ChevronDown size={CRATE_ICON_SIZE.lg} className="size-5" />
        </IconButton>
        <div className="flex items-center gap-2">
          <PlayerSurfaceModeSwitch
            allowVisualizer={state.visualizerAllowed}
            mode={state.vizCfg.surfaceMode}
            onChange={actions.onSurfaceModeChange}
          />
          {state.equalizerEnabled ? (
            <button
              type="button"
              ref={refs.equalizerButtonRef}
              onClick={() => {
                actions.setShowVizSettings(false);
                actions.setShowEqualizer((value) => !value);
              }}
              aria-label={t("player.equalizer")}
              className={cn(
                "rounded-full p-2 backdrop-blur-sm transition-colors",
                state.showEqualizer
                  ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                  : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
              )}
            >
              <SlidersHorizontal size={CRATE_ICON_SIZE.md} />
            </button>
          ) : null}
          {state.visualizerAllowed ? (
            <button
              type="button"
              ref={refs.vizSettingsButtonRef}
              onClick={() => actions.setShowVizSettings((value) => !value)}
              aria-label={t("player.visualizerSettings")}
              disabled={state.vizCfg.surfaceMode !== "visualizer"}
              className={cn(
                "rounded-full p-2 backdrop-blur-sm transition-colors",
                state.vizCfg.surfaceMode !== "visualizer"
                  ? "bg-surface-icon-control text-text-faint"
                  : state.showVizSettings
                    ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                    : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
              )}
            >
              <Settings size={CRATE_ICON_SIZE.md} />
            </button>
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
