/** Temporary release gates for Listen-only features. */
export const JAM_ROOMS_ENABLED = false;

export function isListenAppearanceSettingsEnabled(
  value: string | undefined,
): boolean {
  return value === "true";
}

export const LISTEN_APPEARANCE_SETTINGS_ENABLED =
  isListenAppearanceSettingsEnabled(
    import.meta.env.VITE_LISTEN_APPEARANCE_SETTINGS_ENABLED,
  );
