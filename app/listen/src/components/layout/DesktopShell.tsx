import { RouteContent } from "./RouteContent";
import { Outlet, useLocation } from "react-router";
import { DesktopShellView, type DesktopShellProps } from "./DesktopShellView";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "./TopBar";
import { Sidebar } from "./sidebar/Sidebar";
export function DesktopShell(
  props: Omit<DesktopShellProps, "topBar" | "player" | "sidebar">,
) {
  const location = useLocation();
  return (
    <DesktopShellView
      {...props}
      topBar={<TopBar />}
      player={<PlayerBar />}
      sidebar={<Sidebar />}
    >
      <RouteContent pathname={location.pathname}>
        {props.children ?? <Outlet />}
      </RouteContent>
    </DesktopShellView>
  );
}
