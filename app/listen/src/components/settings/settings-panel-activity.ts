import { createContext, useContext, useEffect, useState } from "react";

// Controllers/drafts stay mounted; transient portals must close when their panel hides.
// Views used outside Settings remain active by default.
export const SettingsPanelActivity = createContext(true);

export function useSettingsPanelActive() {
  return useContext(SettingsPanelActivity);
}

export function useSettingsOverlay() {
  const active = useSettingsPanelActive();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  return [active && open, setOpen] as const;
}
