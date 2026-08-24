import { useState, type FormEvent } from "react";
import {
  ExternalLink,
  FilePlus2,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Rss,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { OpsPageHero, OpsPanel } from "@/components/admin/ops-surfaces";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

interface FeedSource {
  id: number;
  source_kind: string;
  source_scope: string;
  source_url: string;
  canonical_url?: string | null;
  display_name?: string | null;
  publisher_name?: string | null;
  category?: string | null;
  logo_url?: string | null;
  terms_url?: string | null;
  state: "active" | "degraded" | "disabled" | "not_found";
  ai_policy: "enabled" | "manual" | "disabled";
  refresh_interval_seconds: number;
  last_checked_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  active_item_count?: number;
  latest_item_published_at?: string | null;
}

interface FeedSourceItem {
  id: number;
  title: string;
  excerpt?: string | null;
  author?: string | null;
  canonical_url?: string | null;
  published_at?: string | null;
}

interface SourceDraft {
  source_url: string;
  canonical_url: string;
  display_name: string;
  publisher_name: string;
  category: string;
  logo_url: string;
  terms_url: string;
  ai_policy: FeedSource["ai_policy"];
  refresh_interval_seconds: string;
}

const EMPTY_DRAFT: SourceDraft = {
  source_url: "",
  canonical_url: "",
  display_name: "",
  publisher_name: "",
  category: "music_news",
  logo_url: "",
  terms_url: "",
  ai_policy: "enabled",
  refresh_interval_seconds: "86400",
};

function sourceName(source: FeedSource) {
  return source.display_name || source.publisher_name || source.source_url;
}

function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatInterval(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

function statusClasses(state: FeedSource["state"]) {
  if (state === "active") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }
  if (state === "degraded" || state === "not_found") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  }
  return "border-white/15 bg-white/[0.05] text-white/55";
}

function initialDraft(source?: FeedSource | null): SourceDraft {
  if (!source) return { ...EMPTY_DRAFT };
  return {
    source_url: source.source_url,
    canonical_url: source.canonical_url || "",
    display_name: source.display_name || "",
    publisher_name: source.publisher_name || "",
    category: source.category || "music_news",
    logo_url: source.logo_url || "",
    terms_url: source.terms_url || "",
    ai_policy: source.ai_policy,
    refresh_interval_seconds: String(source.refresh_interval_seconds),
  };
}

export function FeedSources() {
  const { data, loading, error, refetch } = useApi<{ items: FeedSource[] }>(
    "/api/admin/external-feeds/sources?limit=100",
  );
  const [selected, setSelected] = useState<FeedSource | null | "new">(null);
  const [previewSource, setPreviewSource] = useState<FeedSource | null>(null);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const {
    data: previewData,
    loading: previewLoading,
    error: previewError,
  } = useApi<{ items: FeedSourceItem[] }>(
    previewSource
      ? `/api/admin/external-feeds/sources/${previewSource.id}/items?limit=10`
      : null,
  );
  const sources = data?.items ?? [];

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setSelected("new");
  }

  function openEdit(source: FeedSource) {
    setDraft(initialDraft(source));
    setSelected(source);
  }

  function closeModal() {
    if (!busy) setSelected(null);
  }

  function updateDraft(field: keyof SourceDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isNew = selected === "new";
    const id = typeof selected === "object" && selected ? selected.id : null;
    const path = isNew
      ? "/api/admin/external-feeds/sources"
      : `/api/admin/external-feeds/sources/${id}`;
    const method = isNew ? "POST" : "PATCH";
    const payload = {
      ...draft,
      refresh_interval_seconds: Number(draft.refresh_interval_seconds),
      ...(isNew ? {} : { source_url: undefined, canonical_url: undefined }),
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    setBusy("save");
    try {
      await api(path, method, cleanPayload);
      toast.success(isNew ? "RSS source added" : "RSS source updated");
      setSelected(null);
      await refetch();
    } catch {
      toast.error("Could not save RSS source");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSource(source: FeedSource) {
    const nextState = source.state === "disabled" ? "active" : "disabled";
    setBusy(`toggle-${source.id}`);
    try {
      await api(`/api/admin/external-feeds/sources/${source.id}`, "PATCH", {
        state: nextState,
      });
      toast.success(
        nextState === "active" ? "Source resumed" : "Source paused",
      );
      await refetch();
    } catch {
      toast.error("Could not update RSS source");
    } finally {
      setBusy(null);
    }
  }

  async function refreshSource(source: FeedSource) {
    setBusy(`refresh-${source.id}`);
    try {
      await api(
        `/api/admin/external-feeds/sources/${source.id}/refresh`,
        "POST",
      );
      toast.success("Source refresh queued");
      await refetch();
    } catch {
      toast.error("Could not queue source refresh");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Rss}
        title="RSS sources"
        description="Manage global music publications that contribute cached articles to Updates."
        actions={
          <Button onClick={openCreate}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Add RSS source
          </Button>
        }
      />

      <OpsPanel
        icon={Rss}
        title="Global publishers"
        description="Sources are refreshed by the worker. The admin UI never fetches provider content directly."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh list
          </Button>
        }
      >
        {error ? (
          <div className="rounded-md border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
            Could not load RSS sources.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sources…
          </div>
        ) : sources.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/15 p-8 text-center">
            <p className="font-medium text-white/75">No global RSS sources</p>
            <p className="mt-1 text-sm text-white/45">
              Add a publication to start building the editorial feed.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => {
              const sourceBusy = busy?.endsWith(`-${source.id}`) ?? false;
              const paused = source.state === "disabled";
              return (
                <article
                  key={source.id}
                  className="rounded-md border border-white/10 bg-black/15 p-4"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">
                          {sourceName(source)}
                        </h3>
                        <Badge className={statusClasses(source.state)}>
                          {source.state}
                        </Badge>
                        <Badge variant="outline">
                          {source.ai_policy === "enabled"
                            ? "AI enabled"
                            : `AI ${source.ai_policy}`}
                        </Badge>
                      </div>
                      <p className="break-all text-sm text-white/45">
                        {source.source_url}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
                        <span>{source.category || "Uncategorized"}</span>
                        <span>
                          {formatInterval(source.refresh_interval_seconds)}
                        </span>
                        <span>
                          {source.active_item_count || 0} active items
                        </span>
                        <span>
                          Last success: {formatDate(source.last_success_at)}
                        </span>
                      </div>
                      {source.last_error ? (
                        <p className="text-xs text-amber-200/80">
                          Last error: {source.last_error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Preview ${sourceName(source)}`}
                        onClick={() => setPreviewSource(source)}
                        disabled={sourceBusy}
                      >
                        <Rss className="mr-2 h-4 w-4" />
                        Preview
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(source)}
                        disabled={sourceBusy}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${
                          paused ? "Resume" : "Pause"
                        } ${sourceName(source)}`}
                        onClick={() => void toggleSource(source)}
                        disabled={sourceBusy}
                      >
                        {paused ? (
                          <Play className="mr-2 h-4 w-4" />
                        ) : (
                          <Pause className="mr-2 h-4 w-4" />
                        )}
                        {paused ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Refresh ${sourceName(source)}`}
                        onClick={() => void refreshSource(source)}
                        disabled={sourceBusy || paused}
                      >
                        {busy === `refresh-${source.id}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Refresh
                      </Button>
                      {source.canonical_url ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={source.canonical_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${sourceName(source)}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </OpsPanel>

      <AppModal
        open={selected !== null}
        onClose={closeModal}
        maxWidthClassName="sm:max-w-2xl"
        panelClassName="max-h-[90vh]"
      >
        <form onSubmit={saveSource}>
          <ModalHeader className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {selected === "new" ? "Add RSS source" : "Edit RSS source"}
                </h2>
                <p className="mt-1 text-sm text-white/45">
                  Publisher feeds are refreshed by the maintenance worker.
                </p>
              </div>
              <ModalCloseButton
                onClick={closeModal}
                aria-label="Close source modal"
              />
            </div>
          </ModalHeader>
          <ModalBody className="space-y-4 overflow-y-auto px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm text-white/65">RSS or Atom URL</span>
                <Input
                  aria-label="RSS or Atom URL"
                  value={draft.source_url}
                  onChange={(event) =>
                    updateDraft("source_url", event.target.value)
                  }
                  placeholder="https://example.com/feed.xml"
                  required
                  disabled={selected !== "new"}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">Display name</span>
                <Input
                  aria-label="Display name"
                  value={draft.display_name}
                  onChange={(event) =>
                    updateDraft("display_name", event.target.value)
                  }
                  placeholder="Pitchfork"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">Publisher</span>
                <Input
                  value={draft.publisher_name}
                  onChange={(event) =>
                    updateDraft("publisher_name", event.target.value)
                  }
                  placeholder="Publisher name"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm text-white/65">
                  Canonical website URL
                </span>
                <Input
                  value={draft.canonical_url}
                  onChange={(event) =>
                    updateDraft("canonical_url", event.target.value)
                  }
                  placeholder="https://example.com"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">Category</span>
                <Input
                  value={draft.category}
                  onChange={(event) =>
                    updateDraft("category", event.target.value)
                  }
                  placeholder="music_news"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">Logo URL</span>
                <Input
                  value={draft.logo_url}
                  onChange={(event) =>
                    updateDraft("logo_url", event.target.value)
                  }
                  placeholder="https://example.com/logo.png"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">
                  Refresh interval (seconds)
                </span>
                <Input
                  type="number"
                  min={300}
                  max={604800}
                  value={draft.refresh_interval_seconds}
                  onChange={(event) =>
                    updateDraft("refresh_interval_seconds", event.target.value)
                  }
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">AI consolidation</span>
                <select
                  className="flex h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-primary"
                  value={draft.ai_policy}
                  onChange={(event) =>
                    updateDraft("ai_policy", event.target.value)
                  }
                >
                  <option value="enabled">Enabled</option>
                  <option value="manual">Manual review</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm text-white/65">Terms URL</span>
                <Input
                  value={draft.terms_url}
                  onChange={(event) =>
                    updateDraft("terms_url", event.target.value)
                  }
                  placeholder="https://example.com/terms"
                />
              </label>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end gap-2 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={closeModal}
              disabled={busy !== null}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null}>
              {busy === "save" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save source
            </Button>
          </ModalFooter>
        </form>
      </AppModal>

      <AppModal
        open={previewSource !== null}
        onClose={() => setPreviewSource(null)}
        maxWidthClassName="sm:max-w-3xl"
        panelClassName="max-h-[90vh]"
      >
        {previewSource ? (
          <>
            <ModalHeader className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    Latest cached items
                  </h2>
                  <p className="mt-1 text-sm text-white/45">
                    {sourceName(previewSource)} · served from Crate storage
                  </p>
                </div>
                <ModalCloseButton
                  onClick={() => setPreviewSource(null)}
                  aria-label="Close preview"
                />
              </div>
            </ModalHeader>
            <ModalBody className="space-y-3 overflow-y-auto px-5 py-5">
              {previewLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading cached items…
                </div>
              ) : previewError ? (
                <p className="rounded-md border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                  Could not load cached items.
                </p>
              ) : previewData?.items.length ? (
                previewData.items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-md border border-white/10 bg-black/15 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-white">{item.title}</h3>
                        <p className="mt-1 text-xs text-white/40">
                          {formatDate(item.published_at)}
                          {item.author ? ` · ${item.author}` : ""}
                        </p>
                      </div>
                      {item.canonical_url ? (
                        <a
                          href={item.canonical_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:text-primary/80"
                          aria-label={`Open ${item.title}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : null}
                    </div>
                    {item.excerpt ? (
                      <p className="mt-3 text-sm leading-6 text-white/60">
                        {item.excerpt}
                      </p>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-white/45">
                  No cached items yet. Refresh the source to ingest its RSS.
                </p>
              )}
            </ModalBody>
          </>
        ) : null}
      </AppModal>
    </div>
  );
}
