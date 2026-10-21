import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { VisualizerSettingsPanel } from "./VisualizerSettingsPanel";
import type { VisualizerPanelState } from "./visualizer-settings";
export const VisualizerSettingsPopover = forwardRef<
  HTMLDivElement,
  { config: VisualizerPanelState }
>(function VisualizerSettingsPopover({ config }, ref) {
  const { t } = useTranslation();
  return (
    <AppPopover
      ref={ref}
      role="dialog"
      aria-label={t("player.visualizerSettings")}
      className="absolute top-14 right-4 z-app-player-popover w-80 max-w-[calc(100%-2rem)] max-h-[calc(100%-4.5rem)] overflow-y-auto p-4"
    >
      <VisualizerSettingsPanel config={config} />
    </AppPopover>
  );
});
