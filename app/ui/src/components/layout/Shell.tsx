import { SkipLink } from "@crate/ui/primitives/SkipLink";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
} from "react";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { VisuallyHidden } from "radix-ui";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@crate/ui/shadcn/sheet";
import { useKeyboard } from "@/hooks/use-keyboard";
import { useNotifications } from "@/hooks/use-notifications";

import { CommandPalette } from "./CommandPalette";
import { HeaderUserMenu } from "./HeaderUserMenu";
import { SearchBar } from "./SearchBar";
import {
  Sidebar,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EVENT,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_KEY,
  getStoredSidebarExpanded,
} from "./Sidebar";

export function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenerRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarExpanded, setSidebarExpanded] = useState(
    getStoredSidebarExpanded,
  );

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const blurSearch = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const showHelp = useCallback(() => {
    if (helpOpen) return;
    helpOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setHelpOpen(true);
  }, [helpOpen]);

  useKeyboard({
    onFocusSearch: focusSearch,
    onBlurSearch: blurSearch,
    onShowHelp: showHelp,
  });

  useNotifications();

  useEffect(() => {
    const sync = () => setSidebarExpanded(getStoredSidebarExpanded());
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

  const overlayHeader =
    /^\/artists\/[^/]+\/[^/]+$/.test(location.pathname) ||
    /^\/albums\/[^/]+\/[^/]+$/.test(location.pathname);
  const sidebarWidthClass = sidebarExpanded ? "md:ml-60" : "md:ml-36";
  const sidebarLeftClass = sidebarExpanded ? "left-60" : "left-36";
  const desktopHeaderOffsetClass = overlayHeader ? "md:pt-0" : "md:pt-24";
  const shellStyle = {
    "--sidebar-w": sidebarExpanded
      ? `${SIDEBAR_EXPANDED_WIDTH}px`
      : `${SIDEBAR_COLLAPSED_WIDTH}px`,
  } as CSSProperties;

  return (
    // --app-header-h is the height of the fixed header (mobile: py-3 around a
    // 40px button; desktop: h-16), plus its 1px bottom border. Sticky children
    // offset themselves by it so they stop below the header.
    <div
      className="min-h-screen bg-app-surface text-foreground [--app-header-h:calc(4rem+1px)] [--sidebar-w:0px]"
      style={shellStyle}
    >
      <SkipLink targetId="admin-main-content">Skip to main content</SkipLink>
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div
          data-admin-ux="mobile-shell-header"
          className="z-app-header fixed inset-x-0 top-0 flex items-center gap-3 border-b border-white/6 bg-app-surface px-4 py-3 md:hidden"
        >
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              className="min-h-11 min-w-11 p-0"
              aria-label="Open navigation"
            >
              <Menu
                size={20}
                data-admin-ux="mobile-navigation"
                aria-hidden="true"
              />
            </Button>
          </SheetTrigger>
          <div className="text-sm font-bold text-white">Crate Admin</div>
          <div className="pointer-events-auto ml-auto">
            <HeaderUserMenu />
          </div>
        </div>

        <SheetContent
          side="left"
          className="w-[240px] p-0"
          showCloseButton={false}
        >
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          <Sidebar
            presentation="drawer"
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div
        data-admin-ux="desktop-shell-header"
        className={`z-app-header fixed top-0 right-0 hidden border-b border-white/6 bg-app-surface transition-[left] duration-200 md:block ${sidebarLeftClass}`}
      >
        <div className="flex h-16 w-full items-center gap-4 px-4 pointer-events-none">
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 text-sm text-text-muted transition-colors hover:bg-surface-control hover:text-text-primary"
              aria-label="Go back"
            >
              <ChevronLeft
                size={16}
                data-admin-ux="history-back"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 text-sm text-text-muted transition-colors hover:bg-surface-control hover:text-text-primary"
              aria-label="Go forward"
            >
              <ChevronRight
                size={16}
                data-admin-ux="history-forward"
                aria-hidden="true"
              />
            </button>
          </div>

          <div className="hidden flex-1 lg:block" />

          <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-3 md:gap-4 lg:w-[560px] lg:flex-none">
            <div className="min-w-0 flex-1">
              <SearchBar inputRef={searchInputRef} />
            </div>
            <HeaderUserMenu />
          </div>
        </div>
      </div>

      {/* overflow-x-clip keeps wide banners from scrolling the page sideways
          without turning <main> into a scroll container, so sticky children
          (decision bars, tab rows) stick to the viewport. Browsers without
          `overflow: clip` (Safari before 16) keep overflow-x-hidden.
          TEST_GAP: jsdom has no layout engine, so sticky behaviour cannot be
          asserted in Vitest; verified in Chrome at 390 and 1440 px. */}
      <main
        id="admin-main-content"
        tabIndex={-1}
        className={`overflow-x-hidden supports-[overflow:clip]:overflow-x-clip transition-[margin-left] duration-200 ${sidebarWidthClass}`}
      >
        <div
          className={`mx-auto w-full max-w-[1880px] px-4 py-4 pt-20 md:py-6 ${
            overlayHeader
              ? "md:px-0"
              : sidebarExpanded
                ? "md:px-6 lg:px-8"
                : "md:px-10 lg:px-12"
          } ${desktopHeaderOffsetClass}`}
        >
          <div key={location.pathname} className="animate-page-in">
            <Outlet />
          </div>
        </div>
      </main>

      <CommandPalette />

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent
          data-admin-ux="help-close"
          className="sm:max-w-sm [&_[data-slot=dialog-close]]:min-h-11 [&_[data-slot=dialog-close]]:min-w-11"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (helpOpenerRef.current?.isConnected)
              helpOpenerRef.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display">Keyboard Shortcuts</DialogTitle>
            <DialogDescription>
              Navigate the admin console quickly with your keyboard.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <Shortcut keys={["/"]} label="Focus search" />
            <Shortcut keys={["⌘", "K"]} label="Command palette" />
            <Shortcut keys={["Esc"]} label="Blur search / close modals" />
            <Shortcut keys={["?"]} label="Show this help" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-mono text-white/70"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
