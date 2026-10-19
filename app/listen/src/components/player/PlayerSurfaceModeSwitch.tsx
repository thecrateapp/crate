import { useRef, type KeyboardEvent } from "react";
import { Disc3, Square, WandSparkles, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { cn } from "@crate/ui/lib/cn";
import type { PlayerSurfaceMode } from "../../lib/player-visualizer-prefs";

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

export function PlayerSurfaceModeSwitch({
  allowVisualizer = true,
  className,
  mode,
  onChange,
}: {
  allowVisualizer?: boolean;
  className?: string;
  mode: PlayerSurfaceMode;
  onChange: (mode: PlayerSurfaceMode) => void;
}) {
  const { t } = useTranslation();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const modes = allowVisualizer
    ? MODES
    : MODES.filter((item) => item.id !== "visualizer");
  const selected = Math.max(
    0,
    modes.findIndex((item) => item.id === mode),
  );
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % modes.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index + modes.length - 1) % modes.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = modes.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
    if (modes[next]!.id !== mode) onChange(modes[next]!.id);
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("player.surface.label")}
      data-slot="player-surface-modes"
      className={cn("flex items-center gap-2", className)}
    >
      {modes.map(({ id, icon: Icon, labelKey }, index) => (
        <ActionButton
          key={id}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          role="radio"
          aria-checked={mode === id}
          data-state={mode === id ? "active" : "inactive"}
          tabIndex={selected === index ? 0 : -1}
          label={t(labelKey)}
          onClick={() => {
            if (mode !== id) onChange(id);
          }}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <Icon
            size={CRATE_ICON_SIZE.md}
            className={
              mode === id ? "text-accent-action-hi" : "text-text-primary"
            }
          />
        </ActionButton>
      ))}
    </div>
  );
}
