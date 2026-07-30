import { useState, useRef, useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AppMenuButton,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";
import {
  Home,
  Radar,
  Search,
  Collection,
  Music,
  Disc,
  Heart,
  Users,
  ListMusic,
  Upload,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Activity,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { MobileActionSheet } from "@crate/ui/domain/actions";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "@/components/layout/TopBar";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { isReservedArtistChildSlug } from "@/lib/library-routes";

const SIDEBAR_KEY = "listen-sidebar-expanded";
const SIDEBAR_EVENT = "listen-sidebar-changed";

function getStoredExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

// ── Sidebar ─────────────────────────────────────────────────────

function Sidebar() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isPlaying, analyserVersion } = usePlayerState();
  const { playSource, currentTrack } = usePlayerActions();
  const discoveryRadioActive =
    isPlaying && playSource?.radio?.seedType === "discovery";
  const { frequenciesDb } = useAudioVisualizer(
    discoveryRadioActive,
    `sidebar:${currentTrack?.id ?? "none"}:${analyserVersion}`,
  );
  const discoveryGlowStrength = useMemo(() => {
    if (!discoveryRadioActive) return 0;
    if (!frequenciesDb.length) return 0.42;
    const bins = frequenciesDb.slice(2, 28);
    if (!bins.length) return 0.42;
    const energy =
      bins.reduce((sum, db) => {
        const normalized = Math.max(0, Math.min(1, (db + 88) / 60));
        return sum + normalized * normalized;
      }, 0) / bins.length;
    return Math.min(1, Math.sqrt(energy));
  }, [discoveryRadioActive, frequenciesDb]);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENT, { detail: { expanded: next } }),
    );
  }

  // Close collection popup on outside click
  useEffect(() => {
    if (!collectionOpen) return;
    function handler(e: MouseEvent) {
      if (
        collectionRef.current &&
        !collectionRef.current.contains(e.target as Node)
      ) {
        setCollectionOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [collectionOpen]);

  const w = expanded ? "w-52" : "w-14";

  function navClass(isActive: boolean) {
    return isActive
      ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
      : "text-white/40 hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]";
  }

  return (
    <aside
      className={`z-app-sidebar fixed top-0 left-0 bottom-0 ${w} flex flex-col border-r border-white/5 bg-app-surface transition-all duration-200`}
    >
      {/* App icon / toggle */}
      <div
        className={`flex items-center ${
          expanded ? "px-4 py-5 gap-3" : "justify-center py-5"
        }`}
      >
        {expanded ? (
          <>
            <div className="relative shrink-0">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-[-10px] rounded-[22px] bg-[radial-gradient(circle,rgba(34,211,238,0.34)_0%,rgba(45,212,191,0.18)_32%,rgba(14,165,233,0.08)_54%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
                style={{
                  opacity: discoveryRadioActive
                    ? 0.22 + discoveryGlowStrength * 0.68
                    : 0,
                  filter: `blur(${12 + discoveryGlowStrength * 8}px)`,
                }}
              />
              <img
                src="/icons/logo.svg"
                alt="Crate"
                className="relative z-10 h-8 w-8 shrink-0 transition-[filter] duration-300"
                style={{
                  filter: discoveryRadioActive
                    ? `drop-shadow(0 0 ${
                        10 + discoveryGlowStrength * 16
                      }px rgba(34,211,238,${
                        0.18 + discoveryGlowStrength * 0.24
                      }))`
                    : "none",
                }}
              />
            </div>
            <span
              className={`text-sm font-bold flex-1 transition-[color,text-shadow] duration-300 ${
                discoveryRadioActive ? "text-cyan-50" : "text-white"
              }`}
              style={{
                textShadow: discoveryRadioActive
                  ? `0 0 ${8 + discoveryGlowStrength * 10}px rgba(34,211,238,${
                      0.12 + discoveryGlowStrength * 0.18
                    })`
                  : "none",
              }}
            >
              Crate
            </span>
            <button
              onClick={toggleExpanded}
              aria-label={t("nav.sidebar.collapse")}
              className="text-white/30 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
            >
              <PanelLeftClose size={CRATE_ICON_SIZE.nav} />
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              toggleExpanded();
              navigate("/");
            }}
            className="relative flex h-10 w-10 items-center justify-center transition-[filter,transform] hover:-translate-y-px hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
            aria-label={t("nav.sidebar.expand")}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-6px] rounded-[18px] bg-[radial-gradient(circle,rgba(34,211,238,0.32)_0%,rgba(45,212,191,0.14)_40%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
              style={{
                opacity: discoveryRadioActive
                  ? 0.2 + discoveryGlowStrength * 0.64
                  : 0,
                filter: `blur(${10 + discoveryGlowStrength * 7}px)`,
              }}
            />
            <img
              src="/icons/logo.svg"
              alt="Crate"
              className="relative z-10 h-6 w-6 transition-[filter] duration-300"
              style={{
                filter: discoveryRadioActive
                  ? `drop-shadow(0 0 ${
                      8 + discoveryGlowStrength * 14
                    }px rgba(34,211,238,${
                      0.16 + discoveryGlowStrength * 0.22
                    }))`
                  : "none",
              }}
            />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav
        className={`flex flex-col gap-1 ${
          expanded ? "px-3" : "items-center px-1"
        }`}
      >
        {/* Home / Music */}
        <NavLink
          to="/"
          end
          title={t("nav.music")}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${
              expanded ? "px-3 py-2" : "w-10 h-10 justify-center"
            } ${navClass(isActive)}`
          }
        >
          <Music size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[13px] font-medium">{t("nav.music")}</span>
          )}
        </NavLink>

        {/* Explore */}
        <NavLink
          to="/explore"
          title={t("nav.explore")}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${
              expanded ? "px-3 py-2" : "w-10 h-10 justify-center"
            } ${navClass(isActive)}`
          }
        >
          <Search size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[13px] font-medium">{t("nav.explore")}</span>
          )}
        </NavLink>

        {/* Radar */}
        <NavLink
          to="/upcoming"
          title={t("nav.radar")}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${
              expanded ? "px-3 py-2" : "w-10 h-10 justify-center"
            } ${navClass(isActive)}`
          }
        >
          <Radar size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[13px] font-medium">{t("nav.radar")}</span>
          )}
        </NavLink>

        <NavLink
          to="/stats"
          title={t("nav.stats")}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${
              expanded ? "px-3 py-2" : "w-10 h-10 justify-center"
            } ${navClass(isActive)}`
          }
        >
          <Activity size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[13px] font-medium">{t("nav.stats")}</span>
          )}
        </NavLink>

        {/* Collection with popup */}
        <div className="relative" ref={collectionRef}>
          <button
            onClick={() => setCollectionOpen(!collectionOpen)}
            title={t("nav.collection")}
            className={`flex items-center gap-3 rounded-lg transition-colors w-full ${
              expanded ? "px-3 py-2" : "w-10 h-10 justify-center"
            } ${
              collectionOpen
                ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
                : "text-white/40 hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
            }`}
          >
            <Collection size={CRATE_ICON_SIZE.nav} />
            {expanded && (
              <>
                <span className="text-[13px] font-medium flex-1 text-left">
                  {t("nav.collection")}
                </span>
                <ChevronRight
                  size={CRATE_ICON_SIZE.sm}
                  className={`transition-transform ${
                    collectionOpen ? "rotate-90" : ""
                  }`}
                />
              </>
            )}
          </button>

          {collectionOpen && (
            <div
              className={`animate-submenu-in ${
                expanded
                  ? "mt-1 ml-3 border-l border-white/5 pl-3"
                  : "absolute left-full top-0 ml-2 w-44 rounded-xl border border-white/10 bg-raised-surface py-2 shadow-2xl"
              }`}
            >
              {[
                {
                  to: "/library?tab=playlists",
                  icon: ListMusic,
                  label: t("nav.collection.playlists"),
                },
                {
                  to: "/library?tab=albums",
                  icon: Disc,
                  label: t("nav.collection.albums"),
                },
                {
                  to: "/library?tab=liked",
                  icon: Heart,
                  label: t("nav.collection.likedTracks"),
                },
                {
                  to: "/library?tab=artists",
                  icon: Users,
                  label: t("nav.collection.artists"),
                },
                {
                  to: "/bandcamp",
                  icon: BandcampLogo,
                  label: t("nav.collection.bandcamp"),
                },
              ].map(({ to, icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={() => {
                    navigate(to);
                    setCollectionOpen(false);
                  }}
                  className={`flex items-center gap-3 rounded-lg transition-[color,filter,transform] w-full text-left text-white/40 hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)] ${
                    expanded ? "px-3 py-1.5" : "px-4 py-2"
                  }`}
                >
                  <Icon size={17} />
                  <span className="text-[12px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom: collapse toggle (only in expanded mode) */}
      {!expanded && (
        <div className="mt-auto flex justify-center pb-4">
          <button
            onClick={toggleExpanded}
            aria-label={t("nav.sidebar.expand")}
            className="text-white/20 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.24)]"
          >
            <PanelLeftOpen size={CRATE_ICON_SIZE.nav} />
          </button>
        </div>
      )}
    </aside>
  );
}

// ── Mobile Bottom Nav ───────────────────────────────────────────

const MOBILE_NAV = [
  { to: "/", icon: Home, labelKey: "nav.home" },
  { to: "/explore", icon: Search, labelKey: "nav.explore" },
  { to: "/upcoming", icon: Radar, labelKey: "nav.radar" },
] as const;

const COLLECTION_SECTIONS = [
  {
    to: "/collection/playlists",
    icon: ListMusic,
    labelKey: "nav.collection.playlists",
  },
  {
    to: "/collection/artists",
    icon: Users,
    labelKey: "nav.collection.artists",
  },
  { to: "/collection/albums", icon: Disc, labelKey: "nav.collection.albums" },
  {
    to: "/collection/liked",
    icon: Heart,
    labelKey: "nav.collection.likedTracks",
  },
  {
    to: "/collection/bandcamp",
    icon: BandcampLogo,
    labelKey: "nav.collection.bandcamp",
  },
  {
    to: "/collection/contributions",
    icon: Upload,
    labelKey: "nav.collection.contributions",
  },
] as const;

function hasOverlayHeader(pathname: string, search = "") {
  if (pathname === "/explore" && new URLSearchParams(search).has("genre")) {
    return true;
  }
  if (
    /^\/artists\/[^/]+$/.test(pathname) ||
    /^\/albums\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/playlist\/[^/]+$/.test(pathname) ||
    /^\/curation\/playlist\/[^/]+$/.test(pathname) ||
    /^\/home\/playlist\/[^/]+$/.test(pathname)
  ) {
    return true;
  }
  const artistChildMatch = pathname.match(/^\/artists\/([^/]+)\/([^/]+)$/);
  if (!artistChildMatch) return false;
  const childSlug = artistChildMatch[2];
  return !isReservedArtistChildSlug(childSlug);
}

// ── Shell ───────────────────────────────────────────────────────

export function Shell() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredExpanded);
  const [collectionSheetOpen, setCollectionSheetOpen] = useState(false);
  const overlayHeader = hasOverlayHeader(location.pathname, location.search);
  const collectionActive =
    location.pathname === "/library" ||
    location.pathname.startsWith("/collection");
  const headerOffsetClass = overlayHeader ? "" : "pt-24";
  const desktopContentPadClass = overlayHeader ? "pt-0 pb-6" : "py-6";
  const mobileContentPadClass = overlayHeader
    ? "pt-0 pb-4"
    : "py-4 pt-[var(--listen-mobile-page-top)]";
  const headerChromeClass =
    "border-b border-white/6 bg-app-surface/68 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl";
  const overlayHeaderChromeClass = overlayHeader
    ? "bg-transparent"
    : headerChromeClass;

  // Sync with sidebar toggle without polling localStorage.
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

  const sidebarW = sidebarExpanded ? "ml-52" : "ml-14";
  const sidebarLeft = sidebarExpanded ? "left-52" : "left-14";
  if (isDesktop) {
    return (
      <div className="flex min-h-screen bg-app-surface">
        <Sidebar />

        <div
          className={`z-app-header fixed top-0 ${sidebarLeft} right-0 transition-all duration-200 ${overlayHeaderChromeClass}`}
        >
          <TopBar hideMobileActions={overlayHeader} />
        </div>

        <main
          className={`relative z-0 flex-1 ${sidebarW} overflow-x-hidden transition-all duration-200 ${
            hasTrack ? "pb-[90px]" : ""
          }`}
        >
          <div
            className={`mx-auto w-full max-w-[1560px] ${desktopContentPadClass} ${
              sidebarExpanded ? "px-6" : "px-10"
            } transition-all duration-200 ${headerOffsetClass}`}
          >
            <Outlet />
          </div>
        </main>

        <PlayerBar />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-app-surface">
      <div
        className={`z-app-header fixed top-0 left-0 right-0 ${
          overlayHeader ? "bg-transparent" : headerChromeClass
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
          className={`mx-auto w-full max-w-[1560px] ${mobileContentPadClass}`}
          style={{
            paddingLeft: "max(1rem, var(--listen-safe-left))",
            paddingRight: "max(1rem, var(--listen-safe-right))",
          }}
        >
          <Outlet />
        </div>
      </main>

      <div
        aria-hidden="true"
        className="listen-glass-panel listen-mobile-dock-glass pointer-events-none fixed z-20 rounded-[12px]"
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

      <nav
        className={`z-app-player fixed isolate flex items-center justify-around overflow-visible bg-transparent px-1.5 ${
          hasTrack ? "rounded-b-[12px] border-t-0" : "rounded-[12px]"
        }`}
        style={{
          bottom:
            "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset))",
          left: "max(1rem, var(--listen-safe-left))",
          right: "max(1rem, var(--listen-safe-right))",
          height: "var(--listen-mobile-bottom-nav-content-height)",
        }}
      >
        {MOBILE_NAV.slice(0, 2).map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1.5 transition-[color,filter,transform] active:scale-[0.97] ${
                isActive
                  ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
                  : "text-white/[0.42] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
              }`
            }
          >
            <Icon size={CRATE_ICON_SIZE.navMobile} />
            <span className="max-w-full truncate text-[9.5px] leading-none">
              {t(labelKey)}
            </span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-label={t("nav.collection")}
          onClick={() => setCollectionSheetOpen(true)}
          className={`flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1.5 transition-[color,filter,transform] active:scale-[0.97] ${
            collectionActive
              ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
              : "text-white/[0.42] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
          }`}
        >
          <Collection size={CRATE_ICON_SIZE.navMobile} />
          <span className="max-w-full truncate text-[9.5px] leading-none">
            {t("nav.collection")}
          </span>
        </button>
        {MOBILE_NAV.slice(2).map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1.5 transition-[color,filter,transform] active:scale-[0.97] ${
                isActive
                  ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
                  : "text-white/[0.42] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
              }`
            }
          >
            <Icon size={CRATE_ICON_SIZE.navMobile} />
            <span className="max-w-full truncate text-[9.5px] leading-none">
              {t(labelKey)}
            </span>
          </NavLink>
        ))}
      </nav>

      <MobileActionSheet
        open={collectionSheetOpen}
        onClose={() => setCollectionSheetOpen(false)}
      >
        <div
          role="menu"
          className="max-h-[calc(100%-5rem)] overflow-y-auto pb-3"
        >
          <div className="px-4 pb-2 pt-2">
            <h2 className="text-base font-semibold text-foreground">
              {t("nav.collection")}
            </h2>
          </div>
          <AppPopoverDivider className="mx-2" />
          <div className="p-1.5">
            {COLLECTION_SECTIONS.map(({ to, icon: Icon, labelKey }) => (
              <AppMenuButton
                key={to}
                role="menuitem"
                onClick={() => {
                  navigate(to);
                  setCollectionSheetOpen(false);
                }}
                className="group"
              >
                <Icon
                  size={CRATE_ICON_SIZE.md}
                  className="text-white/55 transition-colors group-hover:text-primary"
                />
                <span className="text-sm font-semibold">{t(labelKey)}</span>
              </AppMenuButton>
            ))}
          </div>
        </div>
      </MobileActionSheet>
    </div>
  );
}
