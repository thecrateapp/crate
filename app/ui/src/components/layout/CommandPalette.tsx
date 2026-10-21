import { Search } from "lucide-react";
import { OverlayCloseButton } from "@crate/ui/shadcn/overlay-close-button";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { useAuth } from "@/contexts/AuthContext";
import { useTaskCatalog } from "@/lib/task-catalog";
import { toast } from "sonner";

interface SearchResults {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    name: string;
  }[];
}

const COMMAND_FEDERATION_VIEW = ["federation.nodes.view"] as const;

type ActionOutcome =
  | { kind: "queued" }
  | { kind: "already" }
  | { kind: "skipped"; reason: string };

export function describeActionResult(result: unknown): ActionOutcome {
  if (!result || typeof result !== "object") return { kind: "queued" };
  const data = result as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : "";
  if (["already_running", "already_queued", "deduped"].includes(status)) {
    return { kind: "already" };
  }
  if ("task_id" in data && !data.task_id) {
    const reason =
      typeof data.reason === "string" && data.reason
        ? data.reason.replace(/_/g, " ")
        : "";
    return reason ? { kind: "skipped", reason } : { kind: "already" };
  }
  return { kind: "queued" };
}

export function matchesCommandQuery(label: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = label.toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export function CommandPalette() {
  const openerRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { hasAnyCapability } = useAuth();
  const taskCatalog = useTaskCatalog();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(
    null,
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (!open)
          openerRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (query.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api<SearchResults>(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        setSearchResults(data);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function go(path: string) {
    navigate(path);
    close();
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function action(fn: () => Promise<unknown>, label: string) {
    fn()
      .then((result) => {
        const outcome = describeActionResult(result);
        if (outcome.kind === "already") {
          toast.info(`${label} is already queued`);
        } else if (outcome.kind === "skipped") {
          toast.warning(`${label} not started: ${outcome.reason}`);
        } else {
          toast.success(`${label} queued`);
        }
      })
      .catch(() => toast.error(`${label} failed`));
    close();
  }

  const commandActions = (taskCatalog?.actions ?? [])
    .filter((item) => hasAnyCapability([item.capability]))
    .map((item) => ({
      id: item.id,
      label: item.label,
      taskLabel: item.task_label,
      run: () =>
        item.body ? api(item.path, "POST", item.body) : api(item.path, "POST"),
    }));

  const navigationItems = [
    {
      label: "Dashboard",
      path: "/",
      capabilities: ["admin.access"],
    },
    {
      label: "Browse",
      path: "/browse",
      capabilities: ["library.view"],
    },
    {
      label: "Insights",
      path: "/insights",
      capabilities: ["library.view"],
    },
    {
      label: "Health",
      path: "/health",
      capabilities: ["library.repair.run"],
    },
    {
      label: "System Health",
      path: "/system",
      capabilities: ["ops.health.view"],
    },
    {
      label: "Analysis",
      path: "/analysis",
      capabilities: ["library.analysis.manage"],
    },
    {
      label: "Tasks",
      path: "/tasks",
      capabilities: ["ops.tasks.manage"],
    },
    {
      label: "Logs",
      path: "/logs",
      capabilities: ["ops.logs.view"],
    },
    {
      label: "Stack",
      path: "/stack",
      capabilities: ["ops.runtime.manage"],
    },
    {
      label: "Federation",
      path: "/federation",
      capabilities: COMMAND_FEDERATION_VIEW,
    },
    {
      label: "Global Catalog",
      path: "/global-catalog",
      capabilities: COMMAND_FEDERATION_VIEW,
    },
    {
      label: "Users",
      path: "/users",
      capabilities: ["users.view"],
    },
    {
      label: "Agents",
      path: "/agents",

      capabilities: ["agents.plans.review", "agents.integrations.manage"],
    },
    {
      label: "Agent approvals",
      path: "/agents/approvals",

      capabilities: ["agents.plans.review"],
    },
    {
      label: "Roles",
      path: "/roles",
      capabilities: ["roles.view"],
    },
    {
      label: "Acquisition",
      path: "/download",
      capabilities: ["library.import.manage", "library.tidal.manage"],
    },
    {
      label: "Library Trash",
      path: "/trash",
      capabilities: ["library.track.remove"],
    },
    {
      label: "Contributions",
      path: "/contributions",
      capabilities: ["library.import.manage"],
    },
    {
      label: "Bandcamp",
      path: "/bandcamp",
      capabilities: ["library.bandcamp.manage"],
    },
    {
      label: "System Playlists",
      path: "/playlists",
      capabilities: ["curation.playlists.write"],
    },
    {
      label: "Upcoming",
      path: "/upcoming",
      capabilities: [
        "curation.shows.write",
        "curation.releases.write",
        "library.tidal.manage",
      ],
    },
    {
      label: "New Releases",
      path: "/new-releases",
      capabilities: ["curation.releases.write", "library.tidal.manage"],
    },
    {
      label: "Discovery",
      path: "/discover",
      capabilities: ["library.view"],
    },
    {
      label: "AI models",
      path: "/ai",

      capabilities: ["ai.config.read"],
    },
    {
      label: "Settings",
      path: "/settings",
      capabilities: ["settings.manage"],
    },
  ].filter(
    (item) =>
      hasAnyCapability(item.capabilities) &&
      matchesCommandQuery(item.label, query),
  );
  const visibleActions = commandActions.filter((item) =>
    matchesCommandQuery(`${item.label} ${item.taskLabel}`, query),
  );
  const itemClassName =
    "flex min-h-11 items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent";
  const groupClassName =
    "font-mono text-label uppercase tracking-label text-text-subtle px-2 py-1";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openerRef.current?.isConnected) openerRef.current.focus();
        }}
        className="top-[18vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, run actions or find artists and albums.
        </DialogDescription>
        <Command
          label="Search commands"
          shouldFilter={false}
          className="bg-transparent"
        >
          <div className="flex items-center border-b border-border px-3">
            <Search
              size={16}
              data-admin-ux="palette-search"
              aria-hidden="true"
              className="shrink-0 text-text-muted"
            />
            <Command.Input
              aria-label="Search commands"
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search..."
              className="crate-focus-inset w-full px-3 py-3 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono border border-border text-muted-foreground">
              ESC
            </kbd>
          </div>
          <div className="flex justify-end px-3">
            <OverlayCloseButton
              className="min-h-11 min-w-11"
              data-admin-ux="palette-close"
              aria-label="Close command palette"
              onClick={close}
            />
          </div>
          <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found
            </Command.Empty>

            {visibleActions.length > 0 && (
              <Command.Group heading="Actions" className={groupClassName}>
                {visibleActions.map((item) => {
                  return (
                    <Command.Item
                      key={item.id}
                      value={`action:${item.id}`}
                      onSelect={() => action(item.run, item.label)}
                      className={itemClassName}
                    >
                      {item.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {navigationItems.length > 0 && (
              <Command.Group heading="Navigation" className={groupClassName}>
                {navigationItems.map((item) => (
                  <Command.Item
                    key={item.path}
                    value={`nav:${item.path}`}
                    onSelect={() => go(item.path)}
                    className={itemClassName}
                  >
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searchResults?.artists && searchResults.artists.length > 0 && (
              <Command.Group heading="Artists" className={groupClassName}>
                {searchResults.artists.slice(0, 5).map((a) => (
                  <Command.Item
                    key={a.name}
                    value={`artist:${a.name}`}
                    onSelect={() =>
                      go(
                        artistPagePath({
                          artistId: a.id,
                          artistSlug: a.slug,
                          artistName: a.name,
                        }),
                      )
                    }
                    className={itemClassName}
                  >
                    {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searchResults?.albums && searchResults.albums.length > 0 && (
              <Command.Group heading="Albums" className={groupClassName}>
                {searchResults.albums.slice(0, 5).map((a) => (
                  <Command.Item
                    key={`${a.artist}-${a.name}`}
                    value={`album:${a.artist}-${a.name}`}
                    onSelect={() =>
                      go(
                        albumPagePath({
                          albumId: a.id,
                          albumSlug: a.slug,
                          artistName: a.artist,
                          albumName: a.name,
                        }),
                      )
                    }
                    className={itemClassName}
                  >
                    {a.artist} — {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
