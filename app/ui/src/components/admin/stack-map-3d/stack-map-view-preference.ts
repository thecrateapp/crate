import { useCallback, useState } from "react";

export type StackMapView = "2d" | "3d";

export const STACK_MAP_VIEW_STORAGE_KEY = "crate.admin.stack-map.view.v1";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStackMapView(): StackMapView {
  try {
    return storage()?.getItem(STACK_MAP_VIEW_STORAGE_KEY) === "3d"
      ? "3d"
      : "2d";
  } catch {
    return "2d";
  }
}

export function writeStackMapView(view: StackMapView) {
  try {
    storage()?.setItem(STACK_MAP_VIEW_STORAGE_KEY, view);
  } catch {
    return;
  }
}

export function useStackMapView() {
  const [view, setView] = useState<StackMapView>(readStackMapView);
  const update = useCallback((next: StackMapView) => {
    setView(next);
    writeStackMapView(next);
  }, []);
  return [view, update] as const;
}
