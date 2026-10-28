import {
  forwardRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { AppPopover } from "@crate/ui/primitives/AppPopover";

export const PlaybackTargetPopover = forwardRef<
  HTMLDivElement,
  {
    id: string;
    position: CSSProperties;
    onKeyDown: KeyboardEventHandler<HTMLDivElement>;
    children: ReactNode;
  }
>(function PlaybackTargetPopover({ id, position, onKeyDown, children }, ref) {
  const { t } = useTranslation();
  return (
    <AppPopover
      ref={ref}
      id={id}
      role="dialog"
      aria-label={t("player.output.targets")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-app-player-popover w-[min(calc(100vw-1rem),340px)] overflow-y-auto overscroll-contain"
      style={position}
    >
      {children}
    </AppPopover>
  );
});
