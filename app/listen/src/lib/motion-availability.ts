import {
  getUiPreferences,
  setUiPreferences,
  subscribeUiPreferences,
  type MotionPreference,
} from "@crate/ui/lib/interface-preferences";
import {
  isMotionBlocked as isDomMotionBlocked,
  subscribeToMotionAvailability as subscribeToDomMotionAvailability,
} from "@crate/ui/lib/motion-gate";

export function getMotionPreference(): MotionPreference {
  return getUiPreferences().motion;
}

export function setMotionPreference(preference: MotionPreference): void {
  setUiPreferences({ motion: preference });
}

export function isMotionBlocked(
  preference: MotionPreference = getMotionPreference(),
): boolean {
  return preference === "reduced" || isDomMotionBlocked();
}

export function subscribeToMotionAvailability(
  onChange: () => void,
): () => void {
  let previous = getMotionPreference();
  const unsubscribePreferences = subscribeUiPreferences(() => {
    const next = getMotionPreference();
    if (previous === next) return;
    previous = next;
    onChange();
  });
  const unsubscribeDom = subscribeToDomMotionAvailability(onChange);

  return () => {
    unsubscribePreferences();
    unsubscribeDom();
  };
}
