import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export const SHEET_DRAG_ACTIVATION_PX = 8;
export const SHEET_DRAG_OVERSHOOT_PX = 24;
const FALLBACK_PANEL_HEIGHT = 240;

export interface UseSheetDragOptions {
  panelRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onDragStart?: () => void;
  onDismiss: () => void;
}

export interface SheetDragHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

export interface UseSheetDragReturn {
  dragHandleRef: RefObject<HTMLDivElement | null>;
  dragHandleProps: SheetDragHandleProps;
  swipeY: number;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
  setDragOffset: (offset: number) => void;
  getPanelHeight: () => number;
  getDismissOffset: () => number;
  resetDrag: () => void;
  cancelDrag: () => void;
}

function getTouchClientY(event: TouchEvent): number | null {
  return event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? null;
}

export function getScrollableAncestor(
  target: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement | null {
  if (!(target instanceof Node)) return null;

  let node: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;

  while (node && node !== boundary) {
    const style = window.getComputedStyle(node);
    const canScrollY =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight;

    if (canScrollY) return node;
    node = node.parentElement;
  }

  return null;
}

export function useSheetDrag({
  panelRef,
  enabled,
  onDragStart,
  onDismiss,
}: UseSheetDragOptions): UseSheetDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const swipeYRef = useRef(0);
  const swipeStartRef = useRef<number | null>(null);
  const pointerDragIdRef = useRef<number | null>(null);
  const pendingTouchStartYRef = useRef<number | null>(null);
  const pendingTouchTargetRef = useRef<EventTarget | null>(null);
  const dragHandleRef = useRef<HTMLDivElement | null>(null);
  const onDragStartRef = useRef(onDragStart);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDragStartRef.current = onDragStart;
    onDismissRef.current = onDismiss;
  });

  const setDragOffset = useCallback((offset: number) => {
    swipeYRef.current = offset;
    setSwipeY(offset);
  }, []);

  const getPanelHeight = useCallback(() => {
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : FALLBACK_PANEL_HEIGHT;
  }, [panelRef]);

  const getDismissOffset = useCallback(
    () => getPanelHeight() + SHEET_DRAG_OVERSHOOT_PX,
    [getPanelHeight],
  );

  const beginDrag = useCallback(
    (clientY: number) => {
      swipeStartRef.current = clientY;
      onDragStartRef.current?.();
      setIsDragging(true);
      setDragOffset(0);
    },
    [setDragOffset],
  );

  const updateDrag = useCallback(
    (clientY: number) => {
      if (swipeStartRef.current === null) return;
      const dy = clientY - swipeStartRef.current;
      setDragOffset(dy > 0 ? Math.min(dy, getDismissOffset()) : 0);
    },
    [getDismissOffset, setDragOffset],
  );

  const canStartDragFromTarget = useCallback(
    (target: EventTarget | null) => {
      const panel = panelRef.current;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return false;
      }
      if (dragHandleRef.current?.contains(target)) return true;

      const scrollable = getScrollableAncestor(target, panel);
      return !scrollable || scrollable.scrollTop <= 0;
    },
    [panelRef],
  );

  const endDrag = useCallback(() => {
    if (swipeStartRef.current === null) return;
    const shouldDismiss = swipeYRef.current >= getPanelHeight() / 2;
    swipeStartRef.current = null;
    if (shouldDismiss) {
      onDismissRef.current();
      return;
    }
    setIsDragging(false);
    setDragOffset(0);
  }, [getPanelHeight, setDragOffset]);

  const resetDrag = useCallback(() => {
    setIsDragging(false);
    setDragOffset(0);
    swipeStartRef.current = null;
  }, [setDragOffset]);

  const cancelDrag = useCallback(() => {
    resetDrag();
    pointerDragIdRef.current = null;
    pendingTouchStartYRef.current = null;
    pendingTouchTargetRef.current = null;
  }, [resetDrag]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointerDragIdRef.current = event.pointerId;
      beginDrag(event.clientY);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [beginDrag],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerDragIdRef.current !== event.pointerId) return;
      if (swipeStartRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      updateDrag(event.clientY);
    },
    [updateDrag],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerDragIdRef.current !== event.pointerId) return;
      pointerDragIdRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      endDrag();
    },
    [endDrag],
  );

  useEffect(() => {
    if (!enabled) return;
    const panel = panelRef.current;
    if (!panel) return;

    const handleTouchStart = (event: TouchEvent) => {
      const clientY = getTouchClientY(event);
      if (clientY === null) return;
      pendingTouchStartYRef.current = clientY;
      pendingTouchTargetRef.current = event.target;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = pendingTouchStartYRef.current;
      if (startY === null) return;

      const clientY = getTouchClientY(event);
      if (clientY === null) return;

      const dy = clientY - startY;
      if (swipeStartRef.current === null) {
        if (dy <= SHEET_DRAG_ACTIVATION_PX) return;
        if (!canStartDragFromTarget(pendingTouchTargetRef.current)) return;
        beginDrag(startY);
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
      updateDrag(clientY);
    };

    const handleTouchEnd = () => {
      pendingTouchStartYRef.current = null;
      pendingTouchTargetRef.current = null;
      if (swipeStartRef.current !== null) {
        endDrag();
      }
    };

    const handleTouchCancel = () => {
      cancelDrag();
    };

    panel.addEventListener("touchstart", handleTouchStart, { passive: true });
    panel.addEventListener("touchmove", handleTouchMove, { passive: false });
    panel.addEventListener("touchend", handleTouchEnd);
    panel.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      panel.removeEventListener("touchstart", handleTouchStart);
      panel.removeEventListener("touchmove", handleTouchMove);
      panel.removeEventListener("touchend", handleTouchEnd);
      panel.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [
    beginDrag,
    canStartDragFromTarget,
    cancelDrag,
    enabled,
    endDrag,
    panelRef,
    updateDrag,
  ]);

  return {
    dragHandleRef,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelDrag,
    },
    swipeY,
    isDragging,
    setIsDragging,
    setDragOffset,
    getPanelHeight,
    getDismissOffset,
    resetDrag,
    cancelDrag,
  };
}
