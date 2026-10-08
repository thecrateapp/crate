import { Disc3, Square, WandSparkles } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import { cn } from "@crate/ui/lib/cn";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

const MODES: { id: PlayerSurfaceMode; icon: typeof Disc3; labelKey: string }[] =
  [
    { id: "cd", icon: Disc3, labelKey: "player.surface.cd" },
    { id: "cover", icon: Square, labelKey: "player.surface.cover" },
    {
      id: "visualizer",
      icon: WandSparkles,
      labelKey: "player.surface.visualizer",
    },
  ];

interface PlayerSurfaceModeSwitchProps {
  allowVisualizer?: boolean;
  className?: string;
  mode: PlayerSurfaceMode;
  onChange: (mode: PlayerSurfaceMode) => void;
  size?: "sm" | "md";
  variant?: "boxed" | "ghost";
}

export function PlayerSurfaceModeSwitch({
  allowVisualizer = true,
  className,
  mode,
  onChange,
  size = "sm",
  variant = "boxed",
}: PlayerSurfaceModeSwitchProps) {
  const { t } = useTranslation();
  const buttonClass = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const iconSize = size === "md" ? 17 : 15;
  const iconClass = size === "md" ? "size-[17px]" : "size-[15px]";
  const modes = allowVisualizer
    ? MODES
    : MODES.filter((item) => item.id !== "visualizer");

  return (
    <SegmentedControl
      as="tabs"
      variant="tonal"
      label={t("player.surface.label")}
      value={mode}
      onValueChange={onChange}
      items={modes.map(({ id, icon: Icon, labelKey }) => ({
        value: id,
        label: null,
        ariaLabel: t(labelKey),
        icon: <Icon size={iconSize} className={iconClass} />,
      }))}
      className={cn(
        variant === "boxed"
          ? "border border-border-subtle bg-surface-chrome backdrop-blur-sm"
          : "p-0",
        className,
      )}
      itemClassName={cn(
        "px-0 data-[state=active]:bg-accent-action/18 data-[state=inactive]:text-text-muted data-[state=inactive]:hover:text-text-secondary",
        buttonClass,
        variant === "boxed"
          ? "data-[state=inactive]:hover:bg-surface-control"
          : "data-[state=inactive]:hover:bg-surface-chrome",
      )}
    />
  );
}
