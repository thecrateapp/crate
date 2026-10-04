import { Outlet } from "react-router";
import type { ReactNode } from "react";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "@/components/layout/TopBar";

interface MobileShellProps {
  children?: ReactNode;
  collectionActive: boolean;
  hasTrack: boolean;
  headerScrolled: boolean;
  homeMobileOverlay: boolean;
  homePage: boolean;
  mobileContentPadClass: string;
  overlayHeader: boolean;
  headerChromeClass: string;
}

export function MobileShell({
  children,
  collectionActive,
  hasTrack,
  headerScrolled,
  homeMobileOverlay,
  homePage,
  mobileContentPadClass,
  overlayHeader,
  headerChromeClass,
}: MobileShellProps) {
  const transparentHeader =
    (overlayHeader || homeMobileOverlay) && !headerScrolled;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <div
        data-testid="listen-header"
        data-home-overlay={String(homeMobileOverlay)}
        data-transparent={String(transparentHeader)}
        className={`z-app-header fixed top-0 left-0 right-0 transition-[background-color,border-color,box-shadow] duration-200 ${
          transparentHeader ? "bg-transparent" : headerChromeClass
        }`}
        style={{ paddingTop: "var(--listen-safe-top)" }}
      >
        <TopBar hideMobileActions={overlayHeader} />
      </div>
      <main
        className="relative z-0 flex-1 overflow-x-hidden"
        style={{
          paddingBottom: hasTrack
            ? "var(--listen-mobile-bottom-clearance)"
            : "var(--listen-mobile-bottom-clearance-no-player)",
        }}
      >
        <div
          data-testid="listen-content"
          className={`mx-auto w-full ${
            homePage ? "max-w-none" : "max-w-content"
          } ${mobileContentPadClass}`}
          style={{
            paddingLeft: homePage ? 0 : "max(1rem, var(--listen-safe-left))",
            paddingRight: homePage ? 0 : "max(1rem, var(--listen-safe-right))",
          }}
        >
          {children ?? <Outlet />}
        </div>
      </main>
      <div
        aria-hidden="true"
        className="listen-glass-panel listen-mobile-dock-glass pointer-events-none fixed z-20 rounded-panel"
        style={{
          height: hasTrack
            ? "calc(var(--listen-mobile-player-height) + var(--listen-mobile-bottom-nav-content-height))"
            : "var(--listen-mobile-bottom-nav-content-height)",
          bottom:
            "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset))",
          left: "max(1rem, var(--listen-safe-left))",
          right: "max(1rem, var(--listen-safe-right))",
        }}
      />
      <PlayerBar />
      <MobileBottomNav
        collectionActive={collectionActive}
        hasTrack={hasTrack}
      />
    </div>
  );
}
