import { RouteContent } from "./RouteContent";
import { Outlet, useLocation } from "react-router";
import { MobileShellView, type MobileShellProps } from "./MobileShellView";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "./TopBar";
import { MobileBottomNav } from "./MobileBottomNav";
export function MobileShell(
  props: Omit<MobileShellProps, "topBar" | "player" | "bottomNav">,
) {
  const location = useLocation();
  return (
    <MobileShellView
      {...props}
      topBar={<TopBar hideMobileActions={props.overlayHeader} />}
      player={<PlayerBar />}
      bottomNav={
        <MobileBottomNav
          collectionActive={props.collectionActive}
          hasTrack={props.hasTrack}
        />
      }
    >
      <RouteContent pathname={location.pathname}>
        {props.children ?? <Outlet />}
      </RouteContent>
    </MobileShellView>
  );
}
