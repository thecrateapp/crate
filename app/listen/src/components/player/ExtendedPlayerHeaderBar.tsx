import type { TFunction } from "i18next";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import {
  ChevronDown,
  CRATE_ICON_SIZE,
  Settings,
  SlidersHorizontal,
} from "@crate/ui/icons";
import { PlayerSurfaceModeSwitch } from "./PlayerSurfaceModeSwitch";
import type { PlayerSurfaceMode } from "../../lib/player-visualizer-prefs";

export function ExtendedPlayerHeaderBar({
  actions,
  refs,
  state,
  t,
}: {
  actions: {
    closeWithFeedback: () => void;
    onSurfaceModeChange: (mode: PlayerSurfaceMode) => void;
    setShowEqualizer: Dispatch<SetStateAction<boolean>>;
    setShowVizSettings: Dispatch<SetStateAction<boolean>>;
  };
  refs: {
    equalizerButtonRef: RefObject<HTMLButtonElement | null>;
    vizSettingsButtonRef: RefObject<HTMLButtonElement | null>;
  };
  state: {
    equalizerAvailable: boolean;
    showEqualizer: boolean;
    visualizerAllowed: boolean;
    showVizSettings: boolean;
    vizCfg: { surfaceMode: PlayerSurfaceMode };
  };
  t: TFunction;
}) {
  return (
    <div
      data-slot="extended-player-header"
      className="z-app-header absolute top-4 right-4 left-4 flex justify-between"
    >
      <ActionButton
        onClick={actions.closeWithFeedback}
        label={t("player.close")}
      >
        <ChevronDown size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
      <div className="flex items-center gap-2">
        <PlayerSurfaceModeSwitch
          allowVisualizer={state.visualizerAllowed}
          mode={state.vizCfg.surfaceMode}
          onChange={actions.onSurfaceModeChange}
        />
        {state.equalizerAvailable ? (
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
  );
}
