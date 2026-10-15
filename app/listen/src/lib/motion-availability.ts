import type { MotionPreference } from "@crate/ui/lib/appearance-types";
import {
  isMotionBlocked as isDomMotionBlocked,
  subscribeToMotionAvailability as subscribeToDomMotionAvailability,
} from "@crate/ui/lib/motion-gate";

const motionListeners = new Set<() => void>();
let motionPreference: MotionPreference = "system";

export function getMotionPreference(): MotionPreference {
  return motionPreference;
}

export function setMotionPreference(preference: MotionPreference): void {
  if (motionPreference === preference) return;
  motionPreference = preference;
  motionListeners.forEach((listener) => listener());
}

export function isMotionBlocked(
  preference: MotionPreference = motionPreference,
): boolean {
  return preference === "reduced" || isDomMotionBlocked();
}

export function subscribeToMotionAvailability(
  onChange: () => void,
): () => void {
  motionListeners.add(onChange);
  const unsubscribeDom = subscribeToDomMotionAvailability(onChange);

  return () => {
    motionListeners.delete(onChange);
    unsubscribeDom();
  };
}
