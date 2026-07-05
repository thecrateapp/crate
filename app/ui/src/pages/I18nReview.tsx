import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Languages,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
import { Badge } from "@crate/ui/shadcn/badge";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface TranslationRequest {
  id: string;
  app: string;
  locale: string;
  sourceVersion: string;
  client: string | null;
  reason: string;
  status: string;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TranslationBundleSummary {
  id: string;
  app: string;
  locale: string;
  sourceLocale: string;
  sourceVersion: string;
  bundleVersion: string;
  status: string;
  messageCount: number;
  createdAt: string;
  publishedAt: string | null;
}

interface TranslationBundleDetail extends TranslationBundleSummary {
  messages: Record<string, string>;
}

interface TranslationRequestsResponse {
  requests: TranslationRequest[];
}

interface TranslationBundlesResponse {
  bundles: TranslationBundleSummary[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  drafting_ai: "Drafting",
  manual_required: "Manual",
  needs_review: "Needs review",
  published: "Published",
  rejected: "Rejected",
  superseded: "Superseded",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function statusBadgeClass(status: string) {
  if (status === "needs_review") {
    return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
  }
  if (status === "published") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }
  if (status === "rejected") {
    return "border-red-400/25 bg-red-400/10 text-red-200";
  }
  if (status === "manual_required") {
    return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  }
  return "border-white/10 bg-white/5 text-white/65";
}

function bundleKey(locale: string, sourceVersion: string) {
  return `${locale}:${sourceVersion}`;
}

export function I18nReview() {
  const [requests, setRequests] = useState<TranslationRequest[]>([]);
  const [bundles, setBundles] = useState<TranslationBundleSummary[]>([]);
  const [selectedBundle, setSelectedBundle] =
    useState<TranslationBundleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<"publish" | "reject" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const requestsByBundle = useMemo(() => {
    const next = new Map<string, TranslationRequest>();
    for (const request of requests) {
      next.set(bundleKey(request.locale, request.sourceVersion), request);
    }
    return next;
  }, [requests]);

  const loadReviewData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestData, bundleData] = await Promise.all([
        api<TranslationRequestsResponse>("/api/admin/i18n/listen/requests"),
        api<TranslationBundlesResponse>(
          "/api/admin/i18n/listen/bundles?status=needs_review",
        ),
      ]);
      setRequests(requestData.requests ?? []);
      setBundles(bundleData.bundles ?? []);
    } catch (nextError) {
      setError("Failed to load Listen translation review queue");
      toast.error("Failed to load Listen translation review queue");
      console.error(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviewData();
  }, [loadReviewData]);

  const selectBundle = useCallback(async (bundleId: string) => {
    setDetailLoading(true);
    try {
      const detail = await api<TranslationBundleDetail>(
        `/api/admin/i18n/listen/bundles/${bundleId}`,
      );
      setSelectedBundle(detail);
    } catch (nextError) {
      toast.error("Failed to load translation bundle");
      console.error(nextError);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const reviewAction = useCallback(
    async (action: "publish" | "reject") => {
      if (!selectedBundle) return;
      setActionBusy(action);
      try {
        const next = await api<TranslationBundleDetail>(
          `/api/admin/i18n/listen/bundles/${selectedBundle.id}/${action}`,
          "POST",
        );
        setSelectedBundle(next);
        toast.success(
          action === "publish"
            ? "Translation bundle published"
            : "Translation bundle rejected",
        );
        await loadReviewData();
      } catch (nextError) {
        toast.error(
          action === "publish"
            ? "Failed to publish translation bundle"
            : "Failed to reject translation bundle",
        );
        console.error(nextError);
      } finally {
        setActionBusy(null);
      }
    },
    [loadReviewData, selectedBundle],
  );

  const messageRows = selectedBundle
    ? Object.entries(selectedBundle.messages).sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
              <Languages size={21} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Listen translation review
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Review AI drafted Listen bundles before they are published to
              remote clients.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadReviewData}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            Refresh
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-b border-white/8 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Review queue
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {bundles.length} bundle{bundles.length === 1 ? "" : "s"} need
                  review
                </p>
              </div>
              <Badge variant="secondary">{requests.length} requests</Badge>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-56 items-center justify-center text-muted-foreground">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="p-5 text-sm text-red-200">{error}</div>
          ) : bundles.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
              <CheckCircle2 size={30} className="text-emerald-300/80" />
              <div>
                <p className="font-semibold text-white">
                  No Listen bundles waiting for review
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Draft translations will appear here when AI or manual work
                  creates them.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/6">
              {bundles.map((bundle) => {
                const request = requestsByBundle.get(
                  bundleKey(bundle.locale, bundle.sourceVersion),
                );
                const selected = selectedBundle?.id === bundle.id;
                return (
                  <button
                    key={bundle.id}
                    type="button"
                    aria-label={`Review ${bundle.locale}`}
                    onClick={() => void selectBundle(bundle.id)}
                    className={cn(
                      "block w-full px-5 py-4 text-left transition-colors hover:bg-white/[0.04]",
                      selected && "bg-cyan-400/[0.06]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-bold text-white">
                            {bundle.locale}
                          </span>
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(bundle.status)}
                          >
                            {statusLabel(bundle.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-white/62">
                          {bundle.bundleVersion}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {request?.reason ?? "Draft bundle"} ·{" "}
                          {timeAgo(bundle.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-white">
                          {bundle.messageCount} strings
                        </div>
                        <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/35">
                          <Clock size={12} />
                          {request?.client ?? "admin"}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="min-h-[520px] gap-0 overflow-hidden p-0">
          <div className="border-b border-white/8 px-5 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Bundle preview
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Check key coverage and copy before publishing.
                </p>
              </div>
              {selectedBundle ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void reviewAction("reject")}
                    disabled={
                      !!actionBusy || selectedBundle.status !== "needs_review"
                    }
                  >
                    {actionBusy === "reject" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <XCircle size={15} />
                    )}
                    Reject bundle
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void reviewAction("publish")}
                    disabled={
                      !!actionBusy || selectedBundle.status !== "needs_review"
                    }
                  >
                    {actionBusy === "publish" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    Publish bundle
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          {detailLoading ? (
            <div className="flex min-h-[420px] items-center justify-center text-muted-foreground">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : selectedBundle ? (
            <div className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Meta label="Locale" value={selectedBundle.locale} />
                <Meta label="Source" value={selectedBundle.sourceLocale} />
                <Meta label="Version" value={selectedBundle.bundleVersion} />
                <Meta
                  label="Status"
                  value={statusLabel(selectedBundle.status)}
                />
              </div>

              <div className="overflow-hidden rounded-md border border-white/8">
                <div className="grid grid-cols-[minmax(0,0.48fr)_minmax(0,0.52fr)] border-b border-white/8 bg-white/[0.03] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">
                  <span>Key</span>
                  <span>Translation</span>
                </div>
                <div className="max-h-[520px] divide-y divide-white/6 overflow-y-auto">
                  {messageRows.map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[minmax(0,0.48fr)_minmax(0,0.52fr)] gap-4 px-4 py-3 text-sm"
                    >
                      <code className="break-words font-mono text-xs text-cyan-100/80">
                        {key}
                      </code>
                      <span className="break-words text-white/82">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
              <Languages size={32} className="text-white/25" />
              <div>
                <p className="font-semibold text-white">
                  Select a bundle to review
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  The preview shows translated keys exactly as clients will
                  receive them after publish.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/32">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-white">
        {value}
      </div>
    </div>
  );
}
