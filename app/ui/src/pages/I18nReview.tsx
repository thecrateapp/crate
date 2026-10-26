import { useActionLLMStatus } from "@/hooks/use-llm";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { RefreshCw as HeaderRefreshCw, Loader2 } from "lucide-react";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { InfoBadge, type InfoBadgeTone } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Textarea } from "@crate/ui/shadcn/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { AdminSelect } from "@/components/ui/AdminSelect";

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

interface TranslationBundleExport {
  schema: "crate.i18n.bundle.export.v1";
  locale: string;
  sourceVersion: string;
  bundleVersion: string;
  messages: Record<string, string>;
}

interface TranslationRequestsResponse {
  aiConfigured?: boolean;
  requests: TranslationRequest[];
}

interface TranslationBundlesResponse {
  bundles: TranslationBundleSummary[];
}

interface TranslationDraftResponse {
  requestId: string;
  status: string;
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
const DEFAULT_LISTEN_DEV_ORIGIN = "http://127.0.0.1:5174";
const LOCAL_CATALOGS_PATH = "/__crate_i18n/catalogs";

function listenDevOrigin() {
  return (
    import.meta.env.VITE_LISTEN_DEV_ORIGIN ?? DEFAULT_LISTEN_DEV_ORIGIN
  ).replace(/\/$/, "");
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function statusTone(status: string): InfoBadgeTone {
  if (status === "needs_review" || status === "pending") {
    return "warning";
  }
  if (status === "published") {
    return "success";
  }
  if (status === "drafting_ai") {
    return "accent";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "manual_required") {
    return "warning";
  }
  return "neutral";
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
  const draftAI = useActionLLMStatus("i18n.listen.draft");
  const [requests, setRequests] = useState<TranslationRequest[]>([]);
  const [bundles, setBundles] = useState<TranslationBundleSummary[]>([]);
  const [selectedBundle, setSelectedBundle] =
    useState<TranslationBundleDetail | null>(null);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>(
    {},
  );
  const [qualityReport, setQualityReport] =
    useState<TranslationQualityReport | null>(null);
  const [exportedJson, setExportedJson] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ManagerTab>("overview");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [requestedBundle, setRequestedBundle] =
    useState<TranslationBundleSummary | null>(null);
  const bundleRequest = useRef(0);
  const activeBundleId = useRef<string | null>(null);
  const [actionBusy, setActionBusy] = useState<"publish" | "reject" | null>(
    null,
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [workspaceSavingKey, setWorkspaceSavingKey] = useState<string | null>(
    null,
  );
  const [draftBusyLocale, setDraftBusyLocale] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [localCatalogOrigin, setLocalCatalogOrigin] = useState<string | null>(
    null,
  );
  const [exportBusy, setExportBusy] = useState(false);
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
          sourceVersion:
            localeBundles[0]?.sourceVersion ??
            requests.find((request) => request.locale === locale)
              ?.sourceVersion ??
            null,
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
      setAiConfigured(Boolean(requestData.aiConfigured));
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
    return () => {
      bundleRequest.current += 1;
    };
  }, [loadReviewData]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      setLocalCatalogOrigin(null);
      return;
    }

    let cancelled = false;
    const origin = listenDevOrigin();

    fetch(`${origin}${LOCAL_CATALOGS_PATH}`, { method: "GET" })
      .then((response) => {
        if (!cancelled) {
          setLocalCatalogOrigin(response.ok ? origin : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalCatalogOrigin(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectBundle = useCallback(async (bundle: TranslationBundleSummary) => {
    const request = ++bundleRequest.current;
    activeBundleId.current = bundle.id;
    setRequestedBundle(bundle);
    setSelectedBundle(null);
    setDetailError(null);
    setActionBusy(null);
    setSavingKey(null);
    setWorkspaceSavingKey(null);
    setExportBusy(false);
    setDetailLoading(true);
    setQualityReport(null);
    setExportedJson(null);
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
      if (request !== bundleRequest.current) return;
      setSelectedBundle(detail);
      setMessageDrafts(detail.messages);
      setQualityReport(quality);
    } catch (nextError) {
      if (request !== bundleRequest.current) return;
      setDetailError("The translation bundle could not be loaded. Try again.");
      toast.error("Failed to load translation bundle");
      console.error(nextError);
    } finally {
      if (request === bundleRequest.current) setDetailLoading(false);
    }
  }, []);

  const reviewAction = useCallback(
    async (action: "publish" | "reject") => {
      if (
        !selectedBundle ||
        detailLoading ||
        activeBundleId.current !== selectedBundle.id ||
        actionBusy ||
        savingKey !== null
      )
        return;
      const request = bundleRequest.current;
      setActionBusy(action);
      try {
        const next = await api<TranslationBundleDetail>(
          `/api/admin/i18n/listen/bundles/${selectedBundle.id}/${action}`,
          "POST",
        );
        if (request !== bundleRequest.current) return;
        setSelectedBundle(next);
        toast.success(
          action === "publish"
            ? "Translation bundle published"
            : "Translation bundle rejected",
        );
        await loadReviewData();
      } catch (nextError) {
        if (request !== bundleRequest.current) return;
        toast.error(
          action === "publish"
            ? "Failed to publish translation bundle"
            : "Failed to reject translation bundle",
        );
        console.error(nextError);
      } finally {
        if (request === bundleRequest.current) setActionBusy(null);
      }
    },
    [loadReviewData, selectedBundle, detailLoading, actionBusy, savingKey],
  );

  const saveBundleMessage = useCallback(
    async (key: string) => {
      if (
        !selectedBundle ||
        detailLoading ||
        savingKey !== null ||
        actionBusy !== null ||
        activeBundleId.current !== selectedBundle.id
      )
        return;
      const request = bundleRequest.current;
      const sentValue = messageDrafts[key] ?? "";
      setSavingKey(key);
      try {
        const next = await api<TranslationBundleDetail>(
          `/api/admin/i18n/listen/bundles/${
            selectedBundle.id
          }/messages/${encodeURIComponent(key)}`,
          "PATCH",
          { value: sentValue },
        );
        if (request !== bundleRequest.current) return;
        const savedValue = next.messages[key] ?? sentValue;
        setSelectedBundle((current) =>
          current
            ? {
                ...current,
                messages: { ...current.messages, [key]: savedValue },
              }
            : current,
        );
        setMessageDrafts((current) =>
          current[key] === sentValue
            ? { ...current, [key]: savedValue }
            : current,
        );
        toast.success("Translation key saved");
      } catch (nextError) {
        if (request !== bundleRequest.current) return;
        toast.error("Failed to save translation key");
        console.error(nextError);
      } finally {
        if (request === bundleRequest.current) setSavingKey(null);
      }
    },
    [messageDrafts, selectedBundle, detailLoading, savingKey, actionBusy],
  );

  const saveWorkspaceMessage = useCallback(
    async (key: string) => {
      if (
        !selectedBundle ||
        !localCatalogOrigin ||
        detailLoading ||
        activeBundleId.current !== selectedBundle.id
      )
        return;
      const request = bundleRequest.current;
      setWorkspaceSavingKey(key);
      try {
        const response = await fetch(
          `${localCatalogOrigin}${LOCAL_CATALOGS_PATH}/${encodeURIComponent(
            selectedBundle.locale,
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key,
              value: messageDrafts[key] ?? "",
              markReviewed: true,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Listen dev catalog write failed: ${response.status}`,
          );
        }

        if (request === bundleRequest.current)
          toast.success("Translation key saved to workspace JSON");
      } catch (nextError) {
        if (request !== bundleRequest.current) return;
        toast.error("Failed to save translation key to workspace JSON");
        console.error(nextError);
      } finally {
        if (request === bundleRequest.current) setWorkspaceSavingKey(null);
      }
    },
    [localCatalogOrigin, messageDrafts, selectedBundle, detailLoading],
  );

  const draftMissingForLocale = useCallback(
    async (locale: string, sourceVersion: string) => {
      setDraftBusyLocale(locale);
      try {
        await api<TranslationDraftResponse>(
          `/api/admin/i18n/listen/locales/${encodeURIComponent(
            locale,
          )}/draft-missing`,
          "POST",
          { sourceVersion },
        );
        toast.success("AI translation draft queued");
        await loadReviewData();
      } catch (nextError) {
        toast.error("Failed to queue AI translation draft");
        console.error(nextError);
      } finally {
        setDraftBusyLocale(null);
      }
    },
    [loadReviewData],
  );

  const exportSelectedBundle = useCallback(async () => {
    if (
      !selectedBundle ||
      detailLoading ||
      activeBundleId.current !== selectedBundle.id
    )
      return;
    const request = bundleRequest.current;
    setExportBusy(true);
    try {
      const exported = await api<TranslationBundleExport>(
        `/api/admin/i18n/listen/bundles/${selectedBundle.id}/export`,
      );
      if (request !== bundleRequest.current) return;
      setExportedJson(JSON.stringify(exported, null, 2));
      toast.success("Translation bundle exported");
    } catch (nextError) {
      if (request !== bundleRequest.current) return;
      toast.error("Failed to export translation bundle");
      console.error(nextError);
    } finally {
      if (request === bundleRequest.current) setExportBusy(false);
    }
  }, [selectedBundle, detailLoading]);

  const messageRows = selectedBundle
    ? Object.keys(selectedBundle.messages)
        .sort((left, right) => left.localeCompare(right))
        .map(
          (key) =>
            [key, messageDrafts[key] ?? selectedBundle.messages[key] ?? ""] as [
              string,
              string,
            ],
        )
    : [];

  return (
    <div className="min-w-0 space-y-6">
      <OpsPageHero
        title="Listen Translations"
        description="Manage Listen language bundles, review draft quality, and publish remote translations."
        compactActions
        actions={
          <PageHeaderActions>
            <PageHeaderAction
              label="Refresh"
              onClick={loadReviewData}
              disabled={loading}
            >
              {loading ? (
                <Loader2
                  data-admin-ux="translations-refresh"
                  aria-hidden="true"
                  size={15}
                  className="animate-spin"
                />
              ) : null}
              {!loading ? (
                <HeaderRefreshCw
                  data-admin-ux="header-refresh"
                  aria-hidden="true"
                />
              ) : null}
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        <InfoBadge tone={draftAI?.available ? "success" : "warning"}>
          {draftAI?.available
            ? `AI drafts: ${draftAI.model_id}`
            : "AI drafts unavailable · manual review ready"}
        </InfoBadge>
      </OpsPageHero>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ManagerTab)}
        className="gap-5"
      >
        <TabsList aria-label="Listen translation manager sections">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <OverviewSection
            loading={loading}
            error={error}
            localeHealth={localeHealth}
            needsReviewCount={needsReviewCount}
            requestCount={requests.length}
            aiConfigured={aiConfigured}
            draftBusyLocale={draftBusyLocale}
            onDraftMissing={draftMissingForLocale}
          />
        </TabsContent>

        <TabsContent value="bundles" className="mt-0">
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
        </TabsContent>

        <TabsContent value="editor" className="mt-0">
          <EditorSection
            selectedBundle={selectedBundle}
            detailLoading={detailLoading}
            detailError={detailError}
            onRetry={() => {
              if (requestedBundle) void selectBundle(requestedBundle);
            }}
            actionBusy={actionBusy}
            savingKey={savingKey}
            workspaceSavingKey={workspaceSavingKey}
            canSaveWorkspaceJson={localCatalogOrigin !== null}
            exportBusy={exportBusy}
            qualityReport={qualityReport}
            exportedJson={exportedJson}
            messageRows={messageRows}
            onDraftChange={(key, value) =>
              setMessageDrafts((current) => ({ ...current, [key]: value }))
            }
            onSaveMessage={saveBundleMessage}
            onSaveWorkspaceMessage={saveWorkspaceMessage}
            onExportBundle={exportSelectedBundle}
            onReviewAction={reviewAction}
          />
        </TabsContent>

        <TabsContent value="import-export" className="mt-0">
          <ImportExportSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewSection({
  loading,
  error,
  localeHealth,
  needsReviewCount,
  requestCount,
  aiConfigured,
  draftBusyLocale,
  onDraftMissing,
}: {
  loading: boolean;
  error: string | null;
  localeHealth: Array<{
    locale: string;
    draftCount: number;
    publishedCount: number;
    requestCount: number;
    bundleCount: number;
    sourceVersion: string | null;
  }>;
  needsReviewCount: number;
  requestCount: number;
  aiConfigured: boolean;
  draftBusyLocale: string | null;
  onDraftMissing: (locale: string, sourceVersion: string) => Promise<void>;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-border-quiet px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              Locale health
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {needsReviewCount} draft{needsReviewCount === 1 ? "" : "s"} ·{" "}
              {requestCount} request{requestCount === 1 ? "" : "s"}
            </p>
          </div>
          <InfoBadge>{localeHealth.length} locales</InfoBadge>
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <div className="p-5 text-sm text-state-warning-text">{error}</div>
      ) : (
        <div>
          {localeHealth.map((health) => (
            <article
              key={health.locale}
              aria-label={`${health.locale} locale health`}
              className="grid min-w-0 gap-4 border-b border-border-quiet-subtle p-4 last:border-b-0 sm:p-5 md:grid-cols-[minmax(9rem,1.15fr)_repeat(3,minmax(5rem,0.7fr))_minmax(12rem,1.3fr)] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="font-display text-xl font-bold text-text-primary">
                    {health.locale}
                  </div>
                  <StatusDot
                    tone={
                      health.draftCount > 0
                        ? "warn"
                        : health.bundleCount > 0
                          ? "on"
                          : "off"
                    }
                    label={
                      health.draftCount > 0
                        ? "Needs review"
                        : health.bundleCount > 0
                          ? "Stable"
                          : "No bundle"
                    }
                  />
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {health.bundleCount === 0
                    ? "No bundle yet"
                    : `${health.bundleCount} bundle${health.bundleCount === 1 ? "" : "s"} available`}
                </p>
              </div>
              <HealthMetric label="Drafts" value={health.draftCount} />
              <HealthMetric
                label="Published bundles"
                value={health.publishedCount}
              />
              <HealthMetric label="Requests" value={health.requestCount} />
              <Button
                variant="outline"
                size="sm"
                className="w-full md:w-auto"
                aria-label={`Draft missing/stale with AI for ${health.locale}`}
                disabled={
                  !aiConfigured ||
                  !health.sourceVersion ||
                  draftBusyLocale === health.locale
                }
                onClick={() => {
                  if (!health.sourceVersion) return;
                  void onDraftMissing(health.locale, health.sourceVersion);
                }}
              >
                {draftBusyLocale === health.locale ? (
                  <Loader2
                    data-admin-ux="translations-draft"
                    aria-hidden="true"
                    size={15}
                    className="animate-spin"
                  />
                ) : null}
                Draft missing/stale with AI
              </Button>
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
      <div className="border-b border-border-quiet px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              Bundles
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {bundles.length} bundle{bundles.length === 1 ? "" : "s"} in view
            </p>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <FilterSelect
              label="Locale"
              value={localeFilter}
              onChange={setLocaleFilter}
              options={["all", ...localeOptions]}
              formatOption={(value) =>
                value === "all" ? "All locales" : value
              }
            />
            <div className="crate-form-field">
              <MonoLabel as="span" className="block">
                Status
              </MonoLabel>
              <SegmentedControl
                as="radio"
                label="Status"
                value={statusFilter}
                onValueChange={setStatusFilter}
                items={STATUS_FILTERS.map((value) => ({
                  value,
                  label: value === "all" ? "All statuses" : statusLabel(value),
                }))}
              />
            </div>
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
        <div className="p-5 text-sm text-state-warning-text">{error}</div>
      ) : bundles.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
          <div>
            <p className="font-semibold text-white">No bundles match filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Change filters to see draft, published, or rejected bundles.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border-quiet-subtle">
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
                  "block w-full px-5 py-4 text-left transition-colors ",
                  selected && "bg-accent-action/[0.06]",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-slot="entity-title"
                        className="font-display text-lg font-bold text-white"
                      >
                        {bundle.locale}
                      </span>
                      <InfoBadge tone={statusTone(bundle.status)}>
                        {statusLabel(bundle.status)}
                      </InfoBadge>
                    </div>
                    <p className="mt-1 truncate text-sm text-text-muted">
                      {bundle.bundleVersion}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {request?.reason ?? "Translation bundle"} ·{" "}
                      {timeAgo(bundle.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-normal text-white tabular-nums">
                      {bundle.messageCount} strings
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-subtle">
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
  detailError,
  onRetry,
  actionBusy,
  savingKey,
  workspaceSavingKey,
  canSaveWorkspaceJson,
  exportBusy,
  qualityReport,
  exportedJson,
  messageRows,
  onDraftChange,
  onSaveMessage,
  onSaveWorkspaceMessage,
  onExportBundle,
  onReviewAction,
}: {
  selectedBundle: TranslationBundleDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onRetry: () => void;
  actionBusy: "publish" | "reject" | null;
  savingKey: string | null;
  workspaceSavingKey: string | null;
  canSaveWorkspaceJson: boolean;
  exportBusy: boolean;
  qualityReport: TranslationQualityReport | null;
  exportedJson: string | null;
  messageRows: Array<[string, string]>;
  onDraftChange: (key: string, value: string) => void;
  onSaveMessage: (key: string) => Promise<void>;
  onSaveWorkspaceMessage: (key: string) => Promise<void>;
  onExportBundle: () => Promise<void>;
  onReviewAction: (action: "publish" | "reject") => Promise<void>;
}) {
  return (
    <Card className="min-h-[520px] gap-0 overflow-hidden p-0">
      <div className="border-b border-border-quiet px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              Editor
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Preview bundle copy and review quality before publish.
            </p>
          </div>
          {selectedBundle ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onExportBundle()}
                disabled={exportBusy}
              >
                {exportBusy ? (
                  <Loader2
                    data-admin-ux="translations-export"
                    aria-hidden="true"
                    size={15}
                    className="animate-spin"
                  />
                ) : null}
                Export JSON
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onReviewAction("reject")}
                disabled={
                  !!actionBusy ||
                  savingKey !== null ||
                  selectedBundle.status !== "needs_review"
                }
              >
                {actionBusy === "reject" ? (
                  <Loader2
                    data-admin-ux="translations-reject"
                    aria-hidden="true"
                    size={15}
                    className="animate-spin"
                  />
                ) : null}
                Reject bundle
              </Button>
              <Button
                size="sm"
                onClick={() => void onReviewAction("publish")}
                disabled={
                  !!actionBusy ||
                  savingKey !== null ||
                  selectedBundle.status !== "needs_review"
                }
              >
                {actionBusy === "publish" ? (
                  <Loader2
                    data-admin-ux="translations-publish"
                    aria-hidden="true"
                    data-testid="translations-publish-progress"
                    size={15}
                    className="animate-spin"
                  />
                ) : null}
                Publish bundle
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {detailLoading ? (
        <LoadingBlock />
      ) : detailError ? (
        <ErrorState
          title="Translation bundle unavailable"
          message={detailError}
          onRetry={onRetry}
        />
      ) : selectedBundle ? (
        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Meta label="Locale" value={selectedBundle.locale} />
            <Meta label="Source" value={selectedBundle.sourceLocale} />
            <Meta label="Version" value={selectedBundle.bundleVersion} />
            <Meta label="Status" value={statusLabel(selectedBundle.status)} />
          </div>

          <QualityIssues report={qualityReport} />

          <div className="overflow-hidden rounded-md border border-border-quiet">
            <div className="hidden grid-cols-[minmax(0,0.24fr)_minmax(0,0.24fr)_minmax(0,0.36fr)_auto] gap-4 border-b border-border-quiet bg-raised-surface px-4 py-2 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-text-subtle md:grid">
              <span>Key</span>
              <span>English source</span>
              <span>Translation</span>
              <span>Status</span>
            </div>
            <div className="max-h-[520px] divide-y divide-border-quiet-subtle overflow-y-auto">
              {messageRows.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-1 md:grid-cols-[minmax(0,0.24fr)_minmax(0,0.24fr)_minmax(0,0.36fr)_auto] items-start gap-4 px-4 py-3 text-sm"
                >
                  <code className="break-all font-mono text-xs text-accent-action-hi/80">
                    {key}
                  </code>
                  <span className="break-words text-text-subtle">
                    Source unavailable
                  </span>
                  <div className="min-w-0 space-y-2">
                    <FormField
                      id={`translation-${key}`}
                      label="Translation"
                      className="min-w-0"
                    >
                      <Textarea
                        aria-label={`Translation for ${key}`}
                        value={value}
                        onChange={(event) =>
                          onDraftChange(key, event.target.value)
                        }
                        className="min-h-16 resize-y"
                      />
                    </FormField>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Save ${key}`}
                        onClick={() => void onSaveMessage(key)}
                        disabled={savingKey !== null || actionBusy !== null}
                      >
                        {savingKey === key ? (
                          <Loader2
                            data-admin-ux="translations-save"
                            aria-hidden="true"
                            size={15}
                            className="animate-spin"
                          />
                        ) : null}
                        Save
                      </Button>
                      {canSaveWorkspaceJson ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Save ${key} to workspace JSON`}
                          onClick={() => void onSaveWorkspaceMessage(key)}
                          disabled={workspaceSavingKey === key}
                        >
                          {workspaceSavingKey === key ? (
                            <Loader2
                              data-admin-ux="translations-workspace-save"
                              aria-hidden="true"
                              size={15}
                              className="animate-spin"
                            />
                          ) : null}
                          Save to workspace JSON
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <MessageStatusBadge
                    qualityReport={qualityReport}
                    keyName={key}
                  />
                </div>
              ))}
            </div>
          </div>

          {exportedJson ? (
            <div className="overflow-hidden rounded-md border border-border-quiet bg-card">
              <div className="border-b border-border-quiet px-4 py-3">
                <h3 className="font-display text-sm font-semibold text-white">
                  Exported JSON
                </h3>
              </div>
              <pre className="max-h-72 overflow-auto p-4 text-xs text-accent-action-hi/82">
                {exportedJson}
              </pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
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
    <div className="overflow-hidden rounded-md border border-border-quiet bg-raised-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border-quiet px-4 py-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-white">
            Quality issues
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {report
              ? `${report.errorCount} errors · ${report.warningCount} warnings`
              : "Quality report unavailable"}
          </p>
        </div>
        <InfoBadge tone={issues.length > 0 ? "warning" : "success"}>
          {issues.length > 0 ? "Needs work" : "Clean"}
        </InfoBadge>
      </div>
      {issues.length === 0 ? (
        <div className="px-4 py-3 text-sm text-text-muted">
          No quality issues
        </div>
      ) : (
        <div className="divide-y divide-border-quiet-subtle">
          {issues.map((issue) => (
            <div
              key={`${issue.locale}:${issue.key ?? issue.code}:${
                issue.message
              }`}
              className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityMeter
                    level={issue.severity}
                    label={issue.severity}
                  />
                  <code className="break-all font-mono text-meta text-text-secondary">
                    {issue.code}
                  </code>
                </div>
                {issue.key ? (
                  <code className="mt-2 block truncate font-mono text-xs text-accent-action-hi/80">
                    {issue.key}
                  </code>
                ) : null}
              </div>
              <p className="text-text-primary">{issue.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageStatusBadge({
  qualityReport,
  keyName,
}: {
  qualityReport: TranslationQualityReport | null;
  keyName: string;
}) {
  const issue = qualityReport?.issues.find((item) => item.key === keyName);
  if (!issue) {
    return <InfoBadge tone="success">ok</InfoBadge>;
  }
  const status =
    issue.code === "stale_translation"
      ? "stale"
      : issue.code === "missing_key"
        ? "missing"
        : "error";
  return (
    <InfoBadge tone={status === "error" ? "danger" : "warning"}>
      {status}
    </InfoBadge>
  );
}

function ImportExportSection() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="border-b border-border-quiet px-5 py-4">
        <h2 className="font-display text-sm font-semibold text-white">
          Import / Export
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Import availability and the existing JSON export flow.
        </p>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        <div className="rounded-md border border-border-quiet bg-raised-surface p-4">
          <p className="font-semibold text-white">Import JSON</p>
          <p className="mt-2 text-sm text-muted-foreground">
            JSON import is not available. Review existing drafts in Bundles.
          </p>
        </div>
        <div className="rounded-md border border-border-quiet bg-raised-surface p-4">
          <p className="font-semibold text-white">Export bundle</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select a bundle in Bundles, then use Export JSON in Editor.
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
  const selectId = `translation-filter-${label.toLowerCase()}`;

  return (
    <div className="crate-form-field">
      <label
        htmlFor={selectId}
        data-slot="form-field-label"
        className="block font-mono text-meta uppercase tracking-[0.12em] text-text-muted"
      >
        {label}
      </label>
      <AdminSelect
        id={selectId}
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({
          value: option,
          label: formatOption(option),
        }))}
        placeholder={formatOption(options[0] ?? "")}
        allowClear={false}
        triggerClassName="h-11 w-full max-w-none"
      />
    </div>
  );
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  const accessibleLabel =
    label === "Drafts"
      ? `${value} draft${value === 1 ? "" : "s"}`
      : label === "Requests"
        ? `${value} request${value === 1 ? "" : "s"}`
        : `${value} published bundle${value === 1 ? "" : "s"}`;

  return (
    <div role="group" aria-label={accessibleLabel} className="min-w-0">
      <MonoLabel as="div" size="eyebrow">
        {label}
      </MonoLabel>
      <div className="mt-1 font-mono text-xl font-normal tabular-nums text-text-primary">
        {value}
      </div>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div
      role="status"
      aria-label="Loading translations"
      className="flex min-h-56 items-center justify-center text-muted-foreground"
    >
      <Loader2
        data-admin-ux="translations-loading"
        aria-hidden="true"
        size={22}
        className="animate-spin"
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="crate-form-field min-w-0 rounded-md border border-border-quiet bg-raised-surface px-3 py-2">
      <div className="font-mono text-meta uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="break-all font-mono text-sm font-normal text-white">
        {value}
      </div>
    </div>
  );
}
