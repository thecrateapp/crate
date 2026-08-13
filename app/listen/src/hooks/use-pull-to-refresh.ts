import { useRef, useCallback, useState } from "react";

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const gestureRef = useRef<{
    axis: "pending" | "horizontal" | "vertical";
    startX: number;
    startY: number;
  } | null>(null);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const threshold = 80;
  const directionSlop = 8;
  const horizontalAxisBias = 1.15;

  const resetGesture = useCallback(() => {
    gestureRef.current = null;
    pullDistanceRef.current = 0;
    setPullDistance(0);
  }, []);

  const handlers = {
    onTouchStart: useCallback((e: React.TouchEvent) => {
      const el = e.currentTarget;
      if (el.scrollTop > 0 || window.scrollY > 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      gestureRef.current = {
        axis: "pending",
        startX: touch.clientX ?? 0,
        startY: touch.clientY,
      };
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }, []),

    onTouchMove: useCallback(
      (e: React.TouchEvent) => {
        if (refreshing) return;
        const gesture = gestureRef.current;
        const touch = e.touches[0];
        if (!gesture || !touch || gesture.axis === "horizontal") return;

        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        const horizontalDistance = Math.abs(dx);
        const verticalDistance = Math.abs(dy);

        if (gesture.axis === "pending") {
          if (Math.max(horizontalDistance, verticalDistance) < directionSlop)
            return;
          if (horizontalDistance > verticalDistance * horizontalAxisBias) {
            gesture.axis = "horizontal";
            return;
          }
          gesture.axis = "vertical";
        }

        if (dy <= 0) return;
        const distance = Math.min(dy * 0.4, 120);
        if (pullDistanceRef.current !== distance) {
          pullDistanceRef.current = distance;
          setPullDistance(distance);
        }
      },
      [refreshing],
    ),

    onTouchEnd: useCallback(async () => {
      const gesture = gestureRef.current;
      const distance = pullDistanceRef.current;
      if (
        gesture?.axis === "vertical" &&
        distance >= threshold * 0.4 &&
        !refreshing
      ) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
      resetGesture();
    }, [onRefresh, refreshing, resetGesture]),

    onTouchCancel: resetGesture,
  };

  return { handlers, pullDistance, refreshing };
}
