import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import {
  useContextMenuController,
  type ContextMenuPlacement,
} from "./useContextMenuController";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaImageRenderer,
} from "./types";

export type ItemActionMenuEntry = ContextMenuEntry;

export interface UseItemActionMenuOptions {
  disabled?: boolean;
  hasActions?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: ContextMenuPlacement;
}

export interface UseItemActionMenuReturn {
  hasActions: boolean;
  isDesktop: boolean;
  open: boolean;
  position: { x: number; y: number } | null;
  measured: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  openFromTrigger: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  handleKeyboardTrigger: (event: ReactKeyboardEvent<HTMLElement>) => void;
  shouldUseDesktopMenu: boolean;
  longPressHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
}

const LONG_PRESS_MS = 420;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export function useItemActionMenu(
  actions: ItemActionMenuEntry[],
  options: UseItemActionMenuOptions = {},
): UseItemActionMenuReturn {
  const isDesktop = useIsDesktop();
  const {
    disabled = false,
    hasActions: hasActionsOverride,
    onOpenChange,
    placement,
  } = options;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const hasActions = useMemo(
    () =>
      hasActionsOverride ??
      actions.some(
        (entry) =>
          entry.type == null ||
          entry.type === "action" ||
          entry.type === "disclosure",
      ),
    [actions, hasActionsOverride],
  );
  const controller = useContextMenuController<HTMLButtonElement>({
    disabled: disabled || !hasActions,
    placement,
  });
  const { open, position, measured, close, openAtPoint } = controller;

  useEffect(() => {
    // Consumers need the controller's open state to coordinate their trigger.
    // react-doctor-disable-next-line no-pass-data-to-parent
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) longPressTriggeredRef.current = false;
  }, [open]);

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  const handleLongPressPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    longPressTriggeredRef.current = false;
    if (controller.shouldUseDesktopMenu || !hasActions || disabled) return;
    if (event.pointerType === "mouse") return;
    clearLongPress();
    const target = event.currentTarget;
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      longPressTriggeredRef.current = true;
      openAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, LONG_PRESS_MS);
  };

  const handleLongPressPointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const origin = longPressOriginRef.current;
    if (!origin || longPressTimerRef.current == null) return;
    const distance = Math.hypot(
      event.clientX - origin.x,
      event.clientY - origin.y,
    );
    if (distance > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPress();
  };

  const handleLongPressPointerUp = () => {
    clearLongPress();
  };

  const handleLongPressClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!longPressTriggeredRef.current) return;
    const menu = controller.menuRef.current;
    if (menu && event.target instanceof Node && menu.contains(event.target)) {
      longPressTriggeredRef.current = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    longPressTriggeredRef.current = false;
  };

  return {
    hasActions,
    isDesktop,
    open,
    position,
    measured,
    triggerRef: controller.anchorRef,
    menuRef: controller.menuRef,
    close,
    openFromTrigger: controller.openFromTrigger,
    handleContextMenu: controller.handleContextMenu,
    handleKeyboardTrigger: controller.handleKeyboardTrigger,
    shouldUseDesktopMenu: controller.shouldUseDesktopMenu,
    longPressHandlers: {
      onPointerDown: handleLongPressPointerDown,
      onPointerMove: handleLongPressPointerMove,
      onPointerUp: handleLongPressPointerUp,
      onPointerCancel: handleLongPressPointerUp,
      onPointerLeave: handleLongPressPointerUp,
      onClickCapture: handleLongPressClickCapture,
    },
  };
}

export interface ItemActionMenuProps {
  actions: ItemActionMenuEntry[];
  header?: ContextMenuHeader;
  open: boolean;
  position: { x: number; y: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  renderMediaImage?: ContextMenuMediaImageRenderer;
  surfaceClassName?: string;
  sheetLabel?: string;
}

export interface ItemActionMenuButtonProps {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  title?: string;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  hasActions?: boolean;
  expanded?: boolean;
}
