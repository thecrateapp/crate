import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { DesktopShell } from "@/components/layout/DesktopShell";
import { MobileShell } from "@/components/layout/MobileShell";
import {
  SIDEBAR_EVENT,
  SIDEBAR_KEY,
  getStoredExpanded,
} from "@/components/layout/sidebar/sidebar-model";
import {
  TransparentHeaderProvider,
  useTransparentHeaderRegistry,
} from "@/components/layout/transparent-header";
import {
  HEADER_SOLID_SCROLL_THRESHOLD,
  useScrolledPast,
} from "@/components/layout/use-scrolled-past";

export function Shell({ children }: { children?: ReactNode }) {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredExpanded);
  const { transparent: overlayHeader, register } =
    useTransparentHeaderRegistry();
  const homePage = location.pathname === "/";
  const homeDesktopOverlay = isDesktop && homePage;
  const homeMobileOverlay = !isDesktop && homePage;
  const desktopOverlayHeader = overlayHeader || homeDesktopOverlay;
  const collectionActive =
    location.pathname === "/library" ||
    location.pathname.startsWith("/collection");
  const headerScrolled = useScrolledPast(
    HEADER_SOLID_SCROLL_THRESHOLD,
    isDesktop ? desktopOverlayHeader : overlayHeader || homeMobileOverlay,
    location.key,
  );
  const headerOffsetClass = desktopOverlayHeader ? "" : "pt-24";
  const desktopContentPadClass = desktopOverlayHeader ? "pt-0 pb-6" : "py-6";
  const mobileContentPadClass =
    overlayHeader || homeMobileOverlay
      ? "pt-0 pb-4"
      : "py-4 pt-[var(--listen-mobile-page-top)]";
  const headerChromeClass =
    "border-b border-border-quiet bg-surface-chrome shadow-chrome backdrop-blur-xl";

  useEffect(() => {
    const sync = () => setSidebarExpanded(getStoredExpanded());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SIDEBAR_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SIDEBAR_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SIDEBAR_EVENT, sync as EventListener);
    };
  }, []);

  return (
    <TransparentHeaderProvider value={register}>
      {isDesktop ? (
        <DesktopShell
          children={children}
          desktopContentPadClass={desktopContentPadClass}
          desktopOverlayHeader={desktopOverlayHeader}
          hasTrack={hasTrack}
          headerOffsetClass={headerOffsetClass}
          headerScrolled={headerScrolled}
          homeDesktopOverlay={homeDesktopOverlay}
          sidebarLeft={sidebarExpanded ? "left-52" : "left-14"}
          sidebarW={sidebarExpanded ? "ml-52" : "ml-14"}
        />
      ) : (
        <MobileShell
          children={children}
          collectionActive={collectionActive}
          hasTrack={hasTrack}
          headerChromeClass={headerChromeClass}
          headerScrolled={headerScrolled}
          homeMobileOverlay={homeMobileOverlay}
          homePage={homePage}
          mobileContentPadClass={mobileContentPadClass}
          overlayHeader={overlayHeader}
        />
      )}
    </TransparentHeaderProvider>
  );
}
