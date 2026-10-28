import type { ReactNode } from "react";

export interface MobileShellProps {
  topBar: ReactNode;
  player: ReactNode;
  bottomNav: ReactNode;

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

export function MobileShellView({
  topBar,
  player,
  bottomNav,
  children,
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
        {topBar}
      </div>
      <main
        id="listen-main-content"
        tabIndex={-1}
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
          {children}
        </div>
      </main>
      <div
        aria-hidden="true"
        className="listen-mobile-dock-surface listen-mobile-dock-glass border border-border-quiet pointer-events-none fixed z-20 rounded-panel"
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
      {player}
      {bottomNav}
    </div>
  );
}
