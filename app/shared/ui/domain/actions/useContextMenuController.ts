import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import {
  detectTouchDominant,
  shouldRenderDesktopContextMenu,
} from "./ContextMenu";

export type ContextMenuPlacement = "bottom-start" | "bottom-end";

export interface UseContextMenuControllerOptions {
  disabled?: boolean;
  manageDismissal?: boolean;
  placement?: ContextMenuPlacement;
}

export interface UseContextMenuControllerReturn<
  TElement extends HTMLElement = HTMLElement,
> {
  isDesktop: boolean;
  open: boolean;
  position: { x: number; y: number } | null;
  measured: boolean;
  anchorRef: RefObject<TElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  openAtPoint: (x: number, y: number) => void;
  openFromTrigger: (
    event: ReactMouseEvent<TElement>,
    placement?: ContextMenuPlacement,
  ) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  handleKeyboardTrigger: (event: ReactKeyboardEvent<HTMLElement>) => void;
  shouldUseDesktopMenu: boolean;
}

interface AnchorPosition {
  top: number;
  bottom: number;
  right: number;
  placement: ContextMenuPlacement;
}

interface MenuRect {
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

function calculateMenuPosition({
  anchorPosition,
  menuRect,
  rawPosition,
  viewport,
}: {
  anchorPosition: AnchorPosition | null;
  menuRect: MenuRect;
  rawPosition: { x: number; y: number };
  viewport: ViewportSize;
}) {
  const padding = 12;
  const maxX = Math.max(padding, viewport.width - menuRect.width - padding);
  const maxY = Math.max(padding, viewport.height - menuRect.height - padding);
  const anchoredX =
    anchorPosition?.placement === "bottom-end"
      ? anchorPosition.right - menuRect.width
      : rawPosition.x;
  const fitsBelow = anchorPosition
    ? anchorPosition.bottom + 8 + menuRect.height <= viewport.height - padding
    : rawPosition.y + menuRect.height <= viewport.height - padding;
  const preferredY = anchorPosition
    ? fitsBelow
      ? anchorPosition.bottom + 8
      : anchorPosition.top - menuRect.height - 8
    : fitsBelow
      ? rawPosition.y
      : rawPosition.y - menuRect.height - 4;

  return {
    x: Math.min(Math.max(padding, anchoredX), maxX),
    y: Math.min(Math.max(padding, preferredY), maxY),
  };
}

export function useContextMenuController<
  TElement extends HTMLElement = HTMLElement,
>({
  disabled = false,
  manageDismissal = true,
  placement = "bottom-start",
}: UseContextMenuControllerOptions = {}): UseContextMenuControllerReturn<TElement> {
  const isDesktop = useIsDesktop();
  const canHover = useHoverCapability();
  const anchorRef = useRef<TElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [rawPosition, setRawPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [anchorPosition, setAnchorPosition] = useState<AnchorPosition | null>(
    null,
  );
  const [measured, setMeasured] = useState(false);
  const shouldUseDesktopMenu = shouldRenderDesktopContextMenu({
    isDesktop,
    canHover,
    isTouchDominant: detectTouchDominant(),
  });

  const close = () => {
    setOpen(false);
    setRawPosition(null);
    setPosition(null);
    setAnchorPosition(null);
    setMeasured(false);
  };

  const openAtPoint = (x: number, y: number) => {
    if (disabled) return;
    setRawPosition({ x, y });
    setPosition({ x, y });
    setAnchorPosition(null);
    setMeasured(false);
    setOpen(true);
  };

  const openFromTrigger = (
    event: ReactMouseEvent<TElement>,
    nextPlacement = placement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = nextPlacement === "bottom-end" ? rect.right : rect.right - 8;
    setRawPosition({ x, y: rect.bottom + 8 });
    setPosition({ x, y: rect.bottom + 8 });
    setAnchorPosition({
      top: rect.top,
      bottom: rect.bottom,
      right: rect.right,
      placement: nextPlacement,
    });
    setMeasured(false);
    setOpen(true);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openAtPoint(event.clientX + 4, event.clientY + 4);
  };

  const handleKeyboardTrigger = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) return;
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
    active: manageDismissal && shouldUseDesktopMenu && open,
    refs: [menuRef, anchorRef],
    onDismiss: close,
    closeOnScroll: true,
  });

  useLayoutEffect(() => {
    if (!open || !shouldUseDesktopMenu || !rawPosition || !menuRef.current)
      return;

    const updatePosition = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPosition(
        calculateMenuPosition({
          anchorPosition,
          menuRect: rect,
          rawPosition,
          viewport: {
            width: Math.min(
              window.innerWidth,
              document.documentElement.clientWidth || window.innerWidth,
            ),
            height: window.innerHeight,
          },
        }),
      );
    };

    updatePosition();
    setMeasured(true);

    window.addEventListener("resize", updatePosition);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && menuRef.current) {
      observer = new ResizeObserver(updatePosition);
      observer.observe(menuRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePosition);
      observer?.disconnect();
    };
  }, [anchorPosition, open, rawPosition, shouldUseDesktopMenu]);

  return {
    isDesktop,
    open,
    position,
    measured,
    anchorRef,
    menuRef,
    close,
    openAtPoint,
    openFromTrigger,
    handleContextMenu,
    handleKeyboardTrigger,
    shouldUseDesktopMenu,
  };
}
