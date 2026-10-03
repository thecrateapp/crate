import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { UseItemActionMenuReturn } from "./useItemActionMenu";

export interface UseItemActionTargetOptions {
  disabled?: boolean;
}

export interface ItemActionTargetProps {
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}

const noop = () => {};

export function isItemActionMenuKey(
  event: Pick<ReactKeyboardEvent<HTMLElement>, "key" | "shiftKey">,
): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

export function useItemActionTarget(
  actionMenu: Pick<
    UseItemActionMenuReturn,
    | "hasActions"
    | "handleContextMenu"
    | "handleKeyboardTrigger"
    | "longPressHandlers"
  >,
  options: UseItemActionTargetOptions = {},
): ItemActionTargetProps {
  const inactive = Boolean(options.disabled) || !actionMenu.hasActions;
  const { longPressHandlers } = actionMenu;

  if (inactive) {
    return {
      onContextMenu: noop,
      onKeyDown: noop,
      onPointerDown: noop,
      onPointerMove: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
      onPointerLeave: noop,
      onClickCapture: noop,
    };
  }

  return {
    onContextMenu: actionMenu.handleContextMenu,
    onKeyDown: (event) => {
      if (!isItemActionMenuKey(event)) return;
      actionMenu.handleKeyboardTrigger(event);
    },
    onPointerDown: longPressHandlers.onPointerDown,
    onPointerMove: longPressHandlers.onPointerMove,
    onPointerUp: longPressHandlers.onPointerUp,
    onPointerCancel: longPressHandlers.onPointerCancel,
    onPointerLeave: longPressHandlers.onPointerLeave,
    onClickCapture: longPressHandlers.onClickCapture,
  };
}
