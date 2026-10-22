import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { OverlayCloseButton } from "@crate/ui/shadcn/overlay-close-button";
import { useState } from "react";
import { Link } from "react-router";

import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface SidebarProps {
  onNavigate?: () => void;
  presentation?: "rail" | "drawer";
}

export const SIDEBAR_KEY = "crate-admin-sidebar-expanded";
export const SIDEBAR_EVENT = "crate-admin-sidebar-changed";
export const SIDEBAR_EXPANDED_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 144;

export function getStoredSidebarExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

const navItems = [
  {
    to: "/",
    label: "Dashboard",
    capabilities: ["admin.access"],
  },
  {
    to: "/browse",
    label: "Browse",
    capabilities: ["library.view"],
  },
  {
    to: "/discover",
    label: "Discovery",
    capabilities: ["library.view"],
  },
  { section: "Tools" },
  {
    to: "/health",
    label: "Library Health",
    badgeKey: "issue_count" as const,
    capabilities: ["library.repair.run"],
  },
  {
    to: "/trash",
    label: "Library Trash",
    capabilities: ["library.track.remove"],
  },
  {
    to: "/contributions",
    label: "Contributions",
    capabilities: ["library.import.manage"],
  },
  {
    to: "/imports",
    label: "Staged Imports",
    capabilities: ["library.import.manage"],
  },
  { section: "Music" },
  {
    to: "/upcoming",
    label: "Show Management",
    capabilities: ["curation.shows.write", "library.metadata.write"],
  },
  {
    to: "/new-releases",
    label: "Release Radar",
    capabilities: ["curation.releases.write", "library.tidal.manage"],
  },
  {
    to: "/bandcamp",
    label: "Bandcamp",
    capabilities: ["library.bandcamp.manage"],
  },
  {
    to: "/playlists",
    label: "System Playlists",
    capabilities: ["curation.playlists.write"],
  },
  {
    to: "/download",
    label: "Acquisition",
    capabilities: ["library.import.manage", "library.tidal.manage"],
  },
  { section: "Insights" },
  {
    to: "/insights",
    label: "Insights",
    capabilities: ["library.view"],
  },
  {
    to: "/genres",
    label: "Genres",
    capabilities: ["library.view"],
  },
  { section: "System" },
  {
    to: "/system",
    label: "System Health",
    capabilities: ["ops.health.view"],
  },
  {
    to: "/analysis",
    label: "Analysis",
    capabilities: ["library.analysis.manage"],
  },
  {
    to: "/tasks",
    label: "Tasks",
    badgeKey: "running_tasks" as const,
    capabilities: ["ops.tasks.manage"],
  },
  {
    to: "/logs",
    label: "Logs",
    capabilities: ["ops.logs.view"],
  },
  {
    to: "/stack",
    label: "Stack",
    capabilities: ["ops.runtime.manage"],
  },
  {
    to: "/users",
    label: "Users",
    capabilities: ["users.view"],
  },
  {
    to: "/agents",

    label: "Agents",
    badgeKey: "pending_approvals" as const,
    capabilities: ["agents.plans.review", "agents.integrations.manage"],
  },
  {
    to: "/roles",
    label: "Roles",
    capabilities: ["roles.view"],
  },
  {
    to: "/i18n",
    label: "Translations",
    capabilities: ["admin.access"],
  },
  {
    to: "/ai",

    label: "AI models",
    capabilities: ["ai.config.read"],
  },
  {
    to: "/settings",
    label: "Settings",
    capabilities: ["settings.manage"],
  },
  {
    to: "/federation",
    label: "Federation",
    capabilities: ["federation.nodes.view"],
  },
  {
    to: "/global-catalog",
    label: "Global Catalog",
    capabilities: ["federation.nodes.view"],
  },
] as const;

type NavItem = (typeof navItems)[number];
type NavLinkItem = Exclude<NavItem, { section: string }>;

function isSection(
  item: NavItem,
): item is Extract<NavItem, { section: string }> {
  return "section" in item;
}

function canShowNavItem(
  item: NavLinkItem,
  hasAnyCapability: (capabilities: readonly string[]) => boolean,
): boolean {
  return hasAnyCapability(item.capabilities);
}

function getVisibleNavItems(
  hasAnyCapability: (capabilities: readonly string[]) => boolean,
): NavItem[] {
  return navItems.filter((item, index) => {
    if (!isSection(item)) return canShowNavItem(item, hasAnyCapability);
    for (const next of navItems.slice(index + 1)) {
      if (isSection(next)) return false;
      if (canShowNavItem(next, hasAnyCapability)) return true;
    }
    return false;
  });
}

function emitSidebarExpanded(expanded: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(expanded));
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENT, { detail: { expanded } }),
    );
  } catch {
    // ignore persistence failures
  }
}

function navClass(isActive: boolean): string {
  return isActive
    ? "text-text-primary hover:text-accent-action-hi before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent-action-hi before:content-['']"
    : "text-white/42 hover:text-accent-action-hi";
}

export function Sidebar({ onNavigate, presentation = "rail" }: SidebarProps) {
  const [storedExpanded, setExpanded] = useState(getStoredSidebarExpanded);
  const expanded = presentation === "drawer" || storedExpanded;
  const { hasAnyCapability } = useAuth();
  const { data: opsSnapshot } = useOpsSnapshot();
  const pendingApprovals = usePendingApprovals();
  const visibleNavItems = getVisibleNavItems(hasAnyCapability);

  const stats = {
    issue_count: opsSnapshot?.status.issue_count || 0,
    pending_imports: opsSnapshot?.status.pending_imports || 0,
    running_tasks: opsSnapshot?.status.running_tasks || 0,
    pending_approvals: pendingApprovals,
  };

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    emitSidebarExpanded(next);
  }

  const asideWidth = expanded ? "w-60" : "w-36";

  return (
    <aside
      aria-label="Admin sidebar"
      className={cn(
        "z-app-sidebar flex flex-col border-r border-white/6 bg-app-surface transition-[width] duration-200",
        presentation === "drawer"
          ? "relative h-full w-full"
          : "fixed top-0 left-0 bottom-0",
        presentation === "rail" && asideWidth,
      )}
    >
      <div className="border-b border-white/6">
        <div className="flex min-h-16 items-center gap-2 px-3">
          <Link
            to="/"
            aria-label="Crate Admin"
            className="flex min-h-11 min-w-11 items-center gap-2"
            onClick={onNavigate}
          >
            {expanded ? (
              <CrateLogo title="Crate" className="h-8 w-8 shrink-0" />
            ) : null}
            <span className="text-sm font-bold text-text-primary">Crate</span>
          </Link>
          {presentation === "drawer" ? (
            <OverlayCloseButton
              className="ml-auto min-h-11 min-w-11 shrink-0"
              data-admin-ux="drawer-close"
              aria-label="Close navigation"
              onClick={onNavigate}
            />
          ) : (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center text-text-muted transition-colors hover:bg-surface-control hover:text-text-primary"
            >
              {expanded ? (
                <PanelLeftClose
                  size={18}
                  data-admin-ux="sidebar-collapse"
                  aria-hidden="true"
                />
              ) : (
                <PanelLeftOpen
                  size={18}
                  data-admin-ux="sidebar-expand"
                  aria-hidden="true"
                />
              )}
            </button>
          )}
        </div>
      </div>
      <nav
        aria-label="Admin navigation"
        className="flex-1 overflow-y-auto py-3"
      >
        {visibleNavItems.map((item) => {
          if ("section" in item)
            return (
              <MonoLabel
                as="div"
                tone="accent"
                key={`section-${item.section}`}
                className="px-4 pb-2 pt-5"
              >
                {item.section}
              </MonoLabel>
            );
          const badgeValue =
            "badgeKey" in item ? stats[item.badgeKey] : undefined;
          return (
            <div key={item.to} className={expanded ? "px-3" : "px-2"}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "group relative flex min-h-11 items-center gap-2 rounded-md px-3 py-2 transition-colors",
                    navClass(isActive),
                  )
                }
              >
                <MonoLabel
                  as="span"
                  className="min-w-0 flex-1 break-words text-inherit"
                >
                  {item.label}
                </MonoLabel>
                {badgeValue != null && badgeValue > 0 ? (
                  <InfoBadge
                    variant="counter"
                    className="shrink-0 tabular-nums"
                  >
                    {badgeValue}
                  </InfoBadge>
                ) : null}
              </NavLink>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
