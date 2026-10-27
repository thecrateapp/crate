import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import type { PlaybackTarget } from "../../lib/playback-target-data";
import { PlaybackTargetButton } from "./PlaybackTargetButton";
import {
  PlaybackTargetPanel,
  type PlaybackTargetPanelProps,
} from "./PlaybackTargetPanel";
import { PlaybackTargetPopover } from "./PlaybackTargetPopover";
import { focusWithModality } from "@crate/ui/lib/input-modality";

type PickerProps = Omit<
  PlaybackTargetPanelProps,
  "onTarget" | "onDisconnectCast" | "onStopCast"
> & {
  onTarget: (target: PlaybackTarget) => Promise<boolean>;
  onDisconnectCast: () => Promise<boolean>;
  onStopCast: () => Promise<boolean>;
  onOverlayChange?: (open: boolean) => void;
};
export function PlaybackTargetPicker({
  onOverlayChange,
  onTarget,
  onDisconnectCast,
  onStopCast,
  ...panel
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();
  const overlayObserver = useRef(onOverlayChange);
  useEffect(() => {
    overlayObserver.current = onOverlayChange;
  }, [onOverlayChange]);
  const activeTarget = useMemo(
    () =>
      panel.groups
        .flatMap((group) => group.targets)
        .find((target) => target.active),
    [panel.groups],
  );
  const close = useCallback(() => {
    setOpen(false);
    onOverlayChange?.(false);
    focusWithModality(trigger.current, { preventScroll: true });
  }, [onOverlayChange]);
  const updatePosition = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    if (
      (rect.width > 0 || rect.height > 0) &&
      (rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth)
    ) {
      close();
      return;
    }
    const above = Math.max(0, rect.top - 16),
      below = Math.max(0, window.innerHeight - rect.bottom - 16);
    const useAbove = above >= Math.min(360, below);
    setPosition({
      right: Math.max(
        8,
        Math.min(window.innerWidth - rect.right, window.innerWidth - 348),
      ),
      ...(useAbove
        ? { bottom: window.innerHeight - rect.top + 8 }
        : { top: rect.bottom + 8 }),
      maxHeight: Math.max(0, useAbove ? above : below),
    });
  }, [close]);
  useDismissibleLayer({
    active: open,
    refs: [trigger, popover],
    onDismiss: close,
  });
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    if (
      popover.current &&
      (document.activeElement === popover.current ||
        !popover.current.contains(document.activeElement))
    ) {
      focusWithModality(
        popover.current.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"]:not(:disabled)',
        ) ??
          popover.current.querySelector<HTMLElement>("button:not(:disabled)") ??
          popover.current,
      );
    }
  }, [
    open,
    panel.loading,
    panel.error,
    panel.pendingTargetId,
    panel.castAction,
    updatePosition,
  ]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);
  useEffect(
    () => () => {
      overlayObserver.current?.(false);
    },
    [],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      popover.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : index < 0
            ? event.key === "ArrowUp"
              ? items.length - 1
              : 0
            : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
              items.length;
    items[next]?.focus();
  };
  const finish = async (action: () => Promise<boolean>) => {
    if (await action()) close();
  };
  return (
    <>
      <PlaybackTargetButton
        buttonRef={trigger}
        open={open}
        activeTarget={activeTarget}
        controls={id}
        onToggle={() => {
          if (open) close();
          else {
            updatePosition();
            setOpen(true);
            onOverlayChange?.(true);
          }
        }}
      />
      {open
        ? createPortal(
            <PlaybackTargetPopover
              ref={popover}
              id={id}
              position={position}
              onKeyDown={onKeyDown}
            >
              <PlaybackTargetPanel
                {...panel}
                onTarget={(target) => void finish(() => onTarget(target))}
                onDisconnectCast={() => void finish(onDisconnectCast)}
                onStopCast={() => void finish(onStopCast)}
              />
            </PlaybackTargetPopover>,
            document.body,
          )
        : null}
    </>
  );
}
