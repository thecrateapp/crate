import { useEffect, useState } from "react";
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
import {
  LayoutDashboard,
  Library,
  BarChart3,
  HeartPulse,
  Download,
  ListMusic,
  ListTodo,
  Settings,
  RefreshCw,
  Stethoscope,
  Server,
  User,
  Disc3,
  Search,
  BrainCircuit,
  Radio,
  BarChart2,
  Sparkles,
  Compass,
  Archive,
  FileInput,
  FileJson,
  Tags,
  Calendar,
  Activity,
  ScrollText,
  ShieldCheck,
  Trash2,
  HandHeart,
  type LucideIcon,
} from "lucide-react";

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

const ACTION_ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  brain: BrainCircuit,
  calendar: Calendar,
  chart: BarChart2,
  "file-input": FileInput,
  "file-json": FileJson,
  radio: Radio,
  refresh: RefreshCw,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  tags: Tags,
  trash: Trash2,
};

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
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
      icon: ACTION_ICONS[item.icon] ?? Sparkles,
      run: () =>
        item.body ? api(item.path, "POST", item.body) : api(item.path, "POST"),
    }));

  const navigationItems = [
    {
      label: "Dashboard",
      path: "/",
      icon: LayoutDashboard,
      capabilities: ["admin.access"],
    },
    {
      label: "Browse",
      path: "/browse",
      icon: Library,
      capabilities: ["library.view"],
    },
    {
      label: "Insights",
      path: "/insights",
      icon: BarChart3,
      capabilities: ["library.view"],
    },
    {
      label: "Health",
      path: "/health",
      icon: HeartPulse,
      capabilities: ["library.repair.run"],
    },
    {
      label: "System Health",
      path: "/system",
      icon: Activity,
      capabilities: ["ops.health.view"],
    },
    {
      label: "Analysis",
      path: "/analysis",
      icon: BrainCircuit,
      capabilities: ["library.analysis.manage"],
    },
    {
      label: "Tasks",
      path: "/tasks",
      icon: ListTodo,
      capabilities: ["ops.tasks.manage"],
    },
    {
      label: "Logs",
      path: "/logs",
      icon: ScrollText,
      capabilities: ["ops.logs.view"],
    },
    {
      label: "Stack",
      path: "/stack",
      icon: Server,
      capabilities: ["ops.runtime.manage"],
    },
    {
      label: "Federation",
      path: "/federation",
      icon: Server,
      capabilities: COMMAND_FEDERATION_VIEW,
    },
    {
      label: "Global Catalog",
      path: "/global-catalog",
      icon: Library,
      capabilities: COMMAND_FEDERATION_VIEW,
    },
    {
      label: "Users",
      path: "/users",
      icon: User,
      capabilities: ["users.view"],
    },
    {
      label: "Roles",
      path: "/roles",
      icon: ShieldCheck,
      capabilities: ["roles.view"],
    },
    {
      label: "Acquisition",
      path: "/download",
      icon: Download,
      capabilities: ["library.import.manage", "library.tidal.manage"],
    },
    {
      label: "Library Trash",
      path: "/trash",
      icon: Trash2,
      capabilities: ["library.track.remove"],
    },
    {
      label: "Contributions",
      path: "/contributions",
      icon: HandHeart,
      capabilities: ["library.import.manage"],
    },
    {
      label: "Bandcamp",
      path: "/bandcamp",
      icon: Archive,
      capabilities: ["library.bandcamp.manage"],
    },
    {
      label: "System Playlists",
      path: "/playlists",
      icon: ListMusic,
      capabilities: ["curation.playlists.write"],
    },
    {
      label: "Upcoming",
      path: "/upcoming",
      icon: Calendar,
      capabilities: [
        "curation.shows.write",
        "curation.releases.write",
        "library.tidal.manage",
      ],
    },
    {
      label: "New Releases",
      path: "/new-releases",
      icon: Sparkles,
      capabilities: ["curation.releases.write", "library.tidal.manage"],
    },
    {
      label: "Discovery",
      path: "/discover",
      icon: Compass,
      capabilities: ["library.view"],
    },
    {
      label: "Settings",
      path: "/settings",
      icon: Settings,
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
    "flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent";
  const groupClassName = "text-xs text-muted-foreground px-2 py-1";

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
        className="top-[18vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, run actions or find artists and albums.
        </DialogDescription>
        <Command shouldFilter={false} className="bg-transparent">
          <div className="flex items-center border-b border-border px-3">
            <Search size={16} className="text-muted-foreground shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search..."
              className="w-full px-3 py-3 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono border border-border text-muted-foreground">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found
            </Command.Empty>

            {visibleActions.length > 0 && (
              <Command.Group heading="Actions" className={groupClassName}>
                {visibleActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.id}
                      value={`action:${item.id}`}
                      onSelect={() => action(item.run, item.label)}
                      className={itemClassName}
                    >
                      <Icon size={14} className="text-muted-foreground" />
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
                    <item.icon size={14} className="text-muted-foreground" />
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
                    <User size={14} className="text-muted-foreground" />
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
                    <Disc3 size={14} className="text-muted-foreground" />
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
