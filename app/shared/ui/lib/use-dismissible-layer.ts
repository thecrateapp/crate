import { useEffect, useRef, type RefObject } from "react";

type LayerRef = RefObject<HTMLElement | null>;

interface UseDismissibleLayerOptions {
  active: boolean;
  refs: LayerRef[];
  onDismiss: () => void;
  closeOnEscape?: boolean;
  closeOnPointerDownOutside?: boolean;
  closeOnScroll?: boolean;
}

export function useDismissibleLayer({
  active,
  refs,
  onDismiss,
  closeOnEscape = true,
  closeOnPointerDownOutside = true,
  closeOnScroll = false,
}: UseDismissibleLayerOptions) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current !== undefined) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = undefined;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
      if (suppressClickTimerRef.current !== undefined) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const isInside = (target: Node | null) =>
      refsRef.current.some(
        (ref) => ref.current && target && ref.current.contains(target),
      );

    const stopOutsideEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnPointerDownOutside) return;
      if (isInside(event.target as Node | null)) return;
      suppressClickRef.current = true;
      if (suppressClickTimerRef.current !== undefined) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressClickTimerRef.current = undefined;
      }, 400);
      stopOutsideEvent(event);
      onDismissRef.current();
    };

    const handleScroll = (event: Event) => {
      if (!closeOnScroll) return;
      if (isInside(event.target as Node | null)) return;
      onDismissRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismissRef.current();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, closeOnEscape, closeOnPointerDownOutside, closeOnScroll]);
}
