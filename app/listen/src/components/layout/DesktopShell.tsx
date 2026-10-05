import { Outlet } from "react-router";
import type { ReactNode } from "react";

import { PlayerBar } from "@/components/player/PlayerBar";
import { Sidebar } from "@/components/layout/sidebar/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

interface DesktopShellProps {
  children?: ReactNode;
  desktopContentPadClass: string;
  desktopOverlayHeader: boolean;
  hasTrack: boolean;
  headerOffsetClass: string;
  headerScrolled: boolean;
  homeDesktopOverlay: boolean;
  sidebarLeft: string;
  sidebarW: string;
}

export function DesktopShell({
  children,
  desktopContentPadClass,
  desktopOverlayHeader,
  hasTrack,
  headerOffsetClass,
  headerScrolled,
  homeDesktopOverlay,
  sidebarLeft,
  sidebarW,
}: DesktopShellProps) {
  const transparentHeader = desktopOverlayHeader && !headerScrolled;

  return (
    <div className="flex min-h-dvh bg-surface-canvas">
      <Sidebar />
      <div
        data-testid="listen-header"
        data-home-overlay={String(homeDesktopOverlay)}
        data-transparent={String(transparentHeader)}
        className={`listen-desktop-header z-app-header fixed top-0 ${sidebarLeft} right-0 transition-[left,background-color,border-color,box-shadow] duration-200 ${
          transparentHeader
            ? "bg-transparent"
            : "border-b border-border-quiet bg-surface-chrome shadow-chrome backdrop-blur-xl"
        }`}
      >
        {transparentHeader && (
          <div
            aria-hidden="true"
            className="listen-home-top-scrim pointer-events-none absolute inset-x-0 top-0 h-24"
          />
        )}
        <div className="relative z-10">
          <TopBar />
        </div>
      </div>
      <main
        className={`relative z-0 flex-1 ${sidebarW} overflow-x-hidden transition-[margin-left] duration-200 ${
          hasTrack ? "pb-[90px]" : ""
        }`}
      >
        <div
          data-testid="listen-content"
          className={`mx-auto w-full ${desktopContentPadClass} ${
            homeDesktopOverlay ? "max-w-content px-0" : "max-w-content px-6"
          } transition-[padding-top,padding-right,padding-left] duration-200 ${headerOffsetClass}`}
        >
          {children ?? <Outlet />}
        </div>
      </main>
      <PlayerBar />
    </div>
  );
}
