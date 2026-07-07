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

import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
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

interface TranslationQualityIssue {
  severity: "error" | "warning";
  code: string;
  locale: string;
  key?: string | null;
  message: string;
  source?: string | null;
  value?: string | null;
  file?: string | null;
}

interface TranslationQualityReport {
  schema: "crate.listen.i18n.quality.v1";
  sourceVersion: string;
  generatedAt: string;
  locales: string[];
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: TranslationQualityIssue[];
}

interface TranslationRequestsResponse {
  requests: TranslationRequest[];
}

interface TranslationBundlesResponse {
  bundles: TranslationBundleSummary[];
}

type ManagerTab = "overview" | "bundles" | "editor" | "import-export";

const TARGET_LOCALES = ["ca", "de", "es", "eu", "fr", "it"];

const TABS: Array<{ id: ManagerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "bundles", label: "Bundles" },
  { id: "editor", label: "Editor" },
  { id: "import-export", label: "Import / Export" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  drafting_ai: "Drafting",
  manual_required: "Manual",
  needs_review: "Needs review",
  published: "Published",
  rejected: "Rejected",
  superseded: "Superseded",
};

const STATUS_FILTERS = [
  "all",
  "needs_review",
  "published",
  "rejected",
  "superseded",
];

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

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function I18nReview() {
  const [requests, setRequests] = useState<TranslationRequest[]>([]);
  const [bundles, setBundles] = useState<TranslationBundleSummary[]>([]);
  const [selectedBundle, setSelectedBundle] =
    useState<TranslationBundleDetail | null>(null);
  const [qualityReport, setQualityReport] =
    useState<TranslationQualityReport | null>(null);
  const [activeTab, setActiveTab] = useState<ManagerTab>("overview");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
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

  const needsReviewCount = useMemo(
    () => bundles.filter((bundle) => bundle.status === "needs_review").length,
    [bundles],
  );

  const localeOptions = useMemo(
    () =>
      uniqueSorted([
        ...TARGET_LOCALES,
        ...bundles.map((bundle) => bundle.locale),
        ...requests.map((request) => request.locale),
      ]),
    [bundles, requests],
  );

  const sourceOptions = useMemo(
    () => uniqueSorted(bundles.map((bundle) => bundle.sourceVersion)),
    [bundles],
  );

  const localeHealth = useMemo(
    () =>
      localeOptions.map((locale) => {
        const localeBundles = bundles.filter(
          (bundle) => bundle.locale === locale,
        );
        return {
          locale,
          draftCount: localeBundles.filter(
            (bundle) => bundle.status === "needs_review",
          ).length,
          publishedCount: localeBundles.filter(
            (bundle) => bundle.status === "published",
          ).length,
          requestCount: requests.filter((request) => request.locale === locale)
            .length,
          bundleCount: localeBundles.length,
        };
      }),
    [bundles, localeOptions, requests],
  );

  const filteredBundles = useMemo(
    () =>
      bundles.filter((bundle) => {
        if (localeFilter !== "all" && bundle.locale !== localeFilter) {
          return false;
        }
        if (statusFilter !== "all" && bundle.status !== statusFilter) {
          return false;
        }
        if (sourceFilter !== "all" && bundle.sourceVersion !== sourceFilter) {
          return false;
        }
        return true;
      }),
    [bundles, localeFilter, sourceFilter, statusFilter],
  );

  const loadReviewData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestData, bundleData] = await Promise.all([
        api<TranslationRequestsResponse>("/api/admin/i18n/listen/requests"),
        api<TranslationBundlesResponse>("/api/admin/i18n/listen/bundles"),
      ]);
      setRequests(requestData.requests ?? []);
      setBundles(bundleData.bundles ?? []);
    } catch (nextError) {
      setError("Failed to load Listen translation manager");
      toast.error("Failed to load Listen translation manager");
      console.error(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReviewData();
  }, [loadReviewData]);

  const selectBundle = useCallback(async (bundle: TranslationBundleSummary) => {
    setDetailLoading(true);
    setQualityReport(null);
    setActiveTab("editor");
    try {
      const [detail, quality] = await Promise.all([
        api<TranslationBundleDetail>(
          `/api/admin/i18n/listen/bundles/${bundle.id}`,
        ),
        api<TranslationQualityReport>(
          `/api/admin/i18n/listen/quality?locale=${encodeURIComponent(
            bundle.locale,
          )}&source_version=${encodeURIComponent(bundle.sourceVersion)}`,
        ),
      ]);
      setSelectedBundle(detail);
      setQualityReport(quality);
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
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
              <Languages size={21} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Listen Translations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Manage Listen language bundles, review draft quality, and publish
              remote translations.
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

        <div
          role="tablist"
          aria-label="Listen translation manager sections"
          className="mt-5 flex flex-wrap gap-2"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
                activeTab === tab.id
                  ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-100"
                  : "border-white/10 bg-white/[0.03] text-white/58 hover:border-cyan-400/25 hover:text-cyan-100",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
        <OverviewSection
          loading={loading}
          error={error}
          localeHealth={localeHealth}
          needsReviewCount={needsReviewCount}
          requestCount={requests.length}
        />
      ) : null}

      {activeTab === "bundles" ? (
        <BundlesSection
          loading={loading}
          error={error}
          bundles={filteredBundles}
          requestsByBundle={requestsByBundle}
          localeOptions={localeOptions}
          sourceOptions={sourceOptions}
          localeFilter={localeFilter}
          statusFilter={statusFilter}
          sourceFilter={sourceFilter}
          setLocaleFilter={setLocaleFilter}
          setStatusFilter={setStatusFilter}
          setSourceFilter={setSourceFilter}
          selectedBundleId={selectedBundle?.id ?? null}
          onSelectBundle={selectBundle}
        />
      ) : null}

      {activeTab === "editor" ? (
        <EditorSection
          selectedBundle={selectedBundle}
          detailLoading={detailLoading}
          actionBusy={actionBusy}
          qualityReport={qualityReport}
          messageRows={messageRows}
          onReviewAction={reviewAction}
        />
      ) : null}

      {activeTab === "import-export" ? <ImportExportSection /> : null}
    </div>
  );
}

function OverviewSection({
  loading,
  error,
  localeHealth,
  needsReviewCount,
  requestCount,
}: {
  loading: boolean;
  error: string | null;
  localeHealth: Array<{
    locale: string;
    draftCount: number;
    publishedCount: number;
    requestCount: number;
    bundleCount: number;
  }>;
  needsReviewCount: number;
  requestCount: number;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Locale health</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {needsReviewCount} draft{needsReviewCount === 1 ? "" : "s"} ·{" "}
              {requestCount} request{requestCount === 1 ? "" : "s"}
            </p>
          </div>
          <Badge variant="secondary">{localeHealth.length} locales</Badge>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <div className="p-5 text-sm text-red-200">{error}</div>
      ) : (
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {localeHealth.map((health) => (
            <article
              key={health.locale}
              aria-label={`${health.locale} locale health`}
              className="rounded-md border border-white/8 bg-white/[0.03] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-white">
                    {health.locale}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {health.bundleCount === 0 ? "No bundle yet" : "Configured"}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    health.draftCount > 0
                      ? statusBadgeClass("needs_review")
                      : statusBadgeClass("published")
                  }
                >
                  {health.draftCount > 0 ? "Review" : "Stable"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <HealthMetric label="draft" value={health.draftCount} />
                <HealthMetric label="published" value={health.publishedCount} />
                <HealthMetric label="request" value={health.requestCount} />
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function BundlesSection({
  loading,
  error,
  bundles,
  requestsByBundle,
  localeOptions,
  sourceOptions,
  localeFilter,
  statusFilter,
  sourceFilter,
  setLocaleFilter,
  setStatusFilter,
  setSourceFilter,
  selectedBundleId,
  onSelectBundle,
}: {
  loading: boolean;
  error: string | null;
  bundles: TranslationBundleSummary[];
  requestsByBundle: Map<string, TranslationRequest>;
  localeOptions: string[];
  sourceOptions: string[];
  localeFilter: string;
  statusFilter: string;
  sourceFilter: string;
  setLocaleFilter: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setSourceFilter: (value: string) => void;
  selectedBundleId: string | null;
  onSelectBundle: (bundle: TranslationBundleSummary) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Bundles</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {bundles.length} bundle{bundles.length === 1 ? "" : "s"} in view
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <FilterSelect
              label="Locale"
              value={localeFilter}
              onChange={setLocaleFilter}
              options={["all", ...localeOptions]}
              formatOption={(value) =>
                value === "all" ? "All locales" : value
              }
            />
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS}
              formatOption={(value) =>
                value === "all" ? "All statuses" : statusLabel(value)
              }
            />
            <FilterSelect
              label="Source"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={["all", ...sourceOptions]}
              formatOption={(value) =>
                value === "all" ? "All source versions" : value
              }
            />
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <div className="p-5 text-sm text-red-200">{error}</div>
      ) : bundles.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
          <CheckCircle2 size={30} className="text-emerald-300/80" />
          <div>
            <p className="font-semibold text-white">No bundles match filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Change filters to see draft, published, or rejected bundles.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/6">
          {bundles.map((bundle) => {
            const request = requestsByBundle.get(
              bundleKey(bundle.locale, bundle.sourceVersion),
            );
            const selected = selectedBundleId === bundle.id;
            return (
              <button
                key={bundle.id}
                type="button"
                aria-label={`Review ${bundle.locale}`}
                onClick={() => void onSelectBundle(bundle)}
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
                      {request?.reason ?? "Translation bundle"} ·{" "}
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
  );
}

function EditorSection({
  selectedBundle,
  detailLoading,
  actionBusy,
  qualityReport,
  messageRows,
  onReviewAction,
}: {
  selectedBundle: TranslationBundleDetail | null;
  detailLoading: boolean;
  actionBusy: "publish" | "reject" | null;
  qualityReport: TranslationQualityReport | null;
  messageRows: Array<[string, string]>;
  onReviewAction: (action: "publish" | "reject") => Promise<void>;
}) {
  return (
    <Card className="min-h-[520px] gap-0 overflow-hidden p-0">
      <div className="border-b border-white/8 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Editor</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Preview bundle copy and review quality before publish.
            </p>
          </div>
          {selectedBundle ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onReviewAction("reject")}
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
                onClick={() => void onReviewAction("publish")}
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
        <LoadingBlock />
      ) : selectedBundle ? (
        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Meta label="Locale" value={selectedBundle.locale} />
            <Meta label="Source" value={selectedBundle.sourceLocale} />
            <Meta label="Version" value={selectedBundle.bundleVersion} />
            <Meta label="Status" value={statusLabel(selectedBundle.status)} />
          </div>

          <QualityIssues report={qualityReport} />

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
              The selected bundle appears here with quality status and publish
              controls.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function QualityIssues({
  report,
}: {
  report: TranslationQualityReport | null;
}) {
  const issues = report?.issues ?? [];
  return (
    <div className="overflow-hidden rounded-md border border-white/8 bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Quality issues</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {report
              ? `${report.errorCount} errors · ${report.warningCount} warnings`
              : "Quality report unavailable"}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            issues.length > 0
              ? "border-red-400/25 bg-red-400/10 text-red-200"
              : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
          }
        >
          {issues.length > 0 ? "Needs work" : "Clean"}
        </Badge>
      </div>
      {issues.length === 0 ? (
        <div className="px-4 py-3 text-sm text-white/62">No quality issues</div>
      ) : (
        <div className="divide-y divide-white/6">
          {issues.map((issue) => (
            <div
              key={`${issue.locale}:${issue.key ?? issue.code}:${
                issue.message
              }`}
              className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)]"
            >
              <div className="min-w-0">
                <Badge
                  variant="outline"
                  className={
                    issue.severity === "error"
                      ? "border-red-400/25 bg-red-400/10 text-red-200"
                      : "border-amber-400/25 bg-amber-400/10 text-amber-200"
                  }
                >
                  {issue.code}
                </Badge>
                {issue.key ? (
                  <code className="mt-2 block truncate font-mono text-xs text-cyan-100/80">
                    {issue.key}
                  </code>
                ) : null}
              </div>
              <p className="text-white/78">{issue.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportExportSection() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-white/8 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Import / Export</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          JSON bundle tools will land with inline editing.
        </p>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="font-semibold text-white">Import JSON</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Draft creation stays on the existing review flow until import
            actions are wired.
          </p>
        </div>
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="font-semibold text-white">Export bundle</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Published and draft bundle export is reserved for the next API cut.
          </p>
        </div>
      </div>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  formatOption,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatOption: (value: string) => string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors hover:border-cyan-400/25 focus:border-cyan-400/45"
      >
        {options.map((option) => (
          <option
            key={option}
            value={option}
            className="bg-[#101014] text-white"
          >
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/6 bg-black/10 px-2 py-2">
      <div className="font-semibold text-white">
        {value} {label}
        {value === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex min-h-56 items-center justify-center text-muted-foreground">
      <Loader2 size={22} className="animate-spin" />
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
