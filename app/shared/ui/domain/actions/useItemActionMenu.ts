import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import {
  detectTouchDominant,
  shouldRenderDesktopContextMenu,
} from "./ContextMenu";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaImageRenderer,
} from "./types";

export type ItemActionMenuEntry = ContextMenuEntry;

export interface UseItemActionMenuOptions {
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
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
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
}

export function useItemActionMenu(
  actions: ItemActionMenuEntry[],
  options: UseItemActionMenuOptions = {},
): UseItemActionMenuReturn {
  const isDesktop = useIsDesktop();
  const canHover = useHoverCapability();
  const { disabled = false, onOpenChange } = options;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [rawPosition, setRawPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [measured, setMeasured] = useState(false);
  const hasActions = useMemo(
    () =>
      actions.some(
        (entry) =>
          entry.type == null ||
          entry.type === "action" ||
          entry.type === "disclosure",
      ),
    [actions],
  );
  const shouldUseDesktopMenu = shouldRenderDesktopContextMenu({
    isDesktop,
    canHover,
    isTouchDominant: detectTouchDominant(),
  });

  const close = () => {
    setOpen(false);
    setRawPosition(null);
    setPosition(null);
    setMeasured(false);
  };

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const openAtPoint = (x: number, y: number) => {
    if (!hasActions || disabled) return;
    setRawPosition({ x, y });
    setPosition({ x, y });
    setMeasured(false);
    setOpen(true);
  };

  const openFromTrigger = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openAtPoint(rect.right - 8, rect.bottom + 8);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!hasActions || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openAtPoint(event.clientX + 4, event.clientY + 4);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleLongPressPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (shouldUseDesktopMenu || !hasActions || disabled) return;
    if (event.pointerType === "mouse") return;
    longPressTriggeredRef.current = false;
    clearLongPress();
    const target = event.currentTarget;
    longPressTimerRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      longPressTriggeredRef.current = true;
      openAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, 420);
  };

  const handleLongPressPointerUp = () => {
    clearLongPress();
  };

  const handleLongPressClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!longPressTriggeredRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    longPressTriggeredRef.current = false;
  };

  const handleKeyboardTrigger = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!hasActions || disabled) return;
    if (
      !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openAtPoint(rect.right - 8, rect.bottom + 8);
  };

  useDismissibleLayer({
    active: shouldUseDesktopMenu && open,
    refs: [menuRef, triggerRef],
    onDismiss: close,
  });

  useLayoutEffect(() => {
    if (!open || !shouldUseDesktopMenu || !rawPosition || !menuRef.current)
      return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 12;
    const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxY = Math.max(padding, window.innerHeight - rect.height - padding);
    setPosition({
      x: Math.min(rawPosition.x, maxX),
      y: Math.min(rawPosition.y, maxY),
    });
    setMeasured(true);
  }, [shouldUseDesktopMenu, open, rawPosition]);

  return {
    hasActions,
    isDesktop,
    open,
    position,
    measured,
    triggerRef,
    menuRef,
    close,
    openFromTrigger,
    handleContextMenu,
    handleKeyboardTrigger,
    shouldUseDesktopMenu,
    longPressHandlers: {
      onPointerDown: handleLongPressPointerDown,
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
}

export interface ItemActionMenuButtonProps {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  title?: string;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  hasActions?: boolean;
}
