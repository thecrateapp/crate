import { useCallback, useEffect, useRef, useState } from "react";

export function useVolumeInteraction({
  volume,
  canHover,
  onVolumeChange,
  onOverlayChange,
}: {
  volume: number;
  canHover: boolean;
  onVolumeChange: (volume: number) => void;
  onOverlayChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const opened = useRef(false),
    pointerWithin = useRef(false),
    focused = useRef(false),
    dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observer = useRef(onOverlayChange);
  const lastAudible = useRef(volume > 0 ? volume : 0.5);
  useEffect(() => {
    observer.current = onOverlayChange;
  }, [onOverlayChange]);
  useEffect(() => {
    if (volume > 0) lastAudible.current = volume;
  }, [volume]);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const hide = useCallback(() => {
    clearTimer();
    if (!opened.current) return;
    opened.current = false;
    setOpen(false);
    observer.current(false);
    focused.current = false;
    dragging.current = false;
  }, [clearTimer]);
  const show = useCallback(() => {
    clearTimer();
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    observer.current(true);
  }, [clearTimer]);
  const scheduleClose = useCallback(() => {
    clearTimer();
    if (
      !canHover ||
      !opened.current ||
      pointerWithin.current ||
      focused.current ||
      dragging.current
    )
      return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!pointerWithin.current && !focused.current && !dragging.current)
        hide();
    }, 2500);
  }, [canHover, clearTimer, hide]);
  const enter = () => {
    if (!canHover) return;
    pointerWithin.current = true;
    show();
  };
  const leave = () => {
    pointerWithin.current = false;
    scheduleClose();
  };
  const setFocused = (value: boolean) => {
    focused.current = value;
    if (value) clearTimer();
    else scheduleClose();
  };
  const setDragging = (value: boolean) => {
    dragging.current = value;
    if (value) clearTimer();
    else scheduleClose();
  };
  const toggleMute = () => {
    onVolumeChange(volume > 0 ? 0 : lastAudible.current);
  };
  useEffect(() => {
    if (!canHover) clearTimer();
  }, [canHover, clearTimer]);
  useEffect(
    () => () => {
      clearTimer();
      if (opened.current) observer.current(false);
    },
    [clearTimer],
  );
  return {
    open,
    show,
    hide,
    enter,
    leave,
    setFocused,
    setDragging,
    toggleMute,
  };
}
