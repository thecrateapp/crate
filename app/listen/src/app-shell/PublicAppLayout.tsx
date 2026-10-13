import { Outlet } from "react-router";

import { PublicAppProviders } from "@/app-shell/PublicAppProviders";
import { PublicShell } from "@/app-shell/PublicShell";
import { ShareSheetHost } from "@/components/share/ShareSheet";

export function PublicAppLayout() {
  return (
    <PublicAppProviders>
      <PublicShell>
        <Outlet />
      </PublicShell>
      <ShareSheetHost />
    </PublicAppProviders>
  );
}
