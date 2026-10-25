import { useState } from "react";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { RefreshCw } from "@crate/ui/icons";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { useApi } from "@/hooks/use-api";
import { useCollectionInsights } from "@/components/insights/use-collection-insights";
import { InsightSummary } from "@/components/insights/InsightSummary";
import { InsightComparison } from "@/components/insights/InsightComparison";
import { InsightTimeline } from "@/components/insights/InsightTimeline";
import { InsightSonicExplorer } from "@/components/insights/InsightSonicExplorer";
import {
  InsightChanges,
  InsightOpportunities,
} from "@/components/insights/InsightEntityLists";
import {
  minutes,
  number,
  type InsightsWindow,
} from "@/components/insights/insights-model";

const PERIOD_OPTIONS: { value: InsightsWindow; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "Year" },
];

export interface InsightsData {
  countries: Record<string, number>;
  bpm_distribution: { bpm: string; count: number }[];
  energy_danceability: {
    x: number;
    y: number;
    artist: string;
    title: string;
  }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  popularity: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
  }[];
  albums_by_decade: Record<string, number>;
  top_albums: {
    album: string;
    artist: string;
    listeners: number;
    popularity: number;
    popularity_score?: number | null;
    year: string | null;
  }[];
  acoustic_instrumental: {
    x: number;
    y: number;
    artist: string;
    title: string;
  }[];
  feature_coverage: { feature: string; value: number; total: number }[];
  artist_depth: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
    tracks: number;
  }[];
}

export function Insights() {
  const [window, setWindow] = useState<InsightsWindow>("30d");
  const [tab, setTab] = useState("listening");
  const [visited, setVisited] = useState(["listening"]);
  const { data, error, refreshing, refresh } = useCollectionInsights(window);
  const capabilities = useApi<{ smart_mix?: { available?: boolean } }>(
    "/api/capabilities",
  );
  const fullEnabled =
    !capabilities.loading &&
    !capabilities.error &&
    capabilities.data?.smart_mix?.available === true;
  function changeWindow(value: string) {
    setWindow(value as InsightsWindow);
  }
  function changeTab(value: string) {
    setTab(value);
    setVisited((current) =>
      current.includes(value) ? current : [...current, value],
    );
  }
  return (
    <div className="grid min-w-0 gap-8">
      <OpsPageHero
        title="Insights"
        description="Listening and curation across your indexed collection."
        compactActions
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Period"
              className="flex flex-wrap gap-2"
            >
              {PERIOD_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  active={window === option.value}
                  onClick={() => changeWindow(option.value)}
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
            <PageHeaderActions label="Insights actions">
              <PageHeaderAction
                label={refreshing ? "Refreshing insights" : "Refresh insights"}
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  data-admin-ux="insights-refresh"
                  aria-hidden="true"
                  size={18}
                />
              </PageHeaderAction>
            </PageHeaderActions>
          </div>
        }
      >
        {data?.period ? (
          <div className="flex min-w-0 flex-col gap-2">
            <MonoLabel as="p">
              Instance · {data.period.start} – {data.period.end}
            </MonoLabel>
            <MonoLabel as="p">
              Listener-local reported days · history from{" "}
              {data.period.history_start ?? "unknown"}
            </MonoLabel>
            <MonoLabel as="p">
              {data.period.previous_complete
                ? `Previous: ${data.period.previous_start} – ${data.period.previous_end}`
                : "Previous period is incomplete; comparisons are unavailable."}
            </MonoLabel>
            <MonoLabel as="p">
              {data.snapshot?.built_at &&
              Number.isFinite(Date.parse(data.snapshot.built_at)) ? (
                <>
                  Snapshot built{" "}
                  <time dateTime={data.snapshot.built_at}>
                    {new Date(data.snapshot.built_at).toLocaleString()}
                  </time>
                </>
              ) : (
                "Snapshot time unavailable"
              )}
              {data.snapshot?.stale ? " · Snapshot is stale." : ""}
            </MonoLabel>
            {data.excluded ? (
              <p className="text-xs text-text-muted">
                {number(data.excluded.plays)} excluded plays ·{" "}
                {minutes(data.excluded.minutes)} outside the indexed local
                catalogue.
              </p>
            ) : null}
          </div>
        ) : null}
      </OpsPageHero>
      <Tabs value={tab} onValueChange={changeTab} className="gap-6">
        <TabsList aria-label="Insights sections">
          <TabsTrigger value="listening">Listening</TabsTrigger>
          <TabsTrigger value="collection">Collection</TabsTrigger>
          <TabsTrigger value="sonic">Sonic explorer</TabsTrigger>
        </TabsList>
        {error ? (
          <div
            role="status"
            className="flex flex-col gap-2 text-sm text-text-muted"
          >
            <p>
              {data?.ready
                ? "Insights could not refresh. Showing the last successful snapshot."
                : "Collection insights could not be loaded."}
            </p>
            <p>Use Refresh insights to retry.</p>
          </div>
        ) : null}
        {!data && !error ? (
          <LoadingState label="Loading collection insights" />
        ) : null}
        {data && !data.ready && !error ? (
          <section
            aria-label="Insights pending"
            className="flex flex-col gap-3"
          >
            <h2 className="font-display text-lg">
              Insights are being prepared
            </h2>
            <p className="text-sm text-text-muted">
              {refreshing
                ? "Waiting for the collection snapshot to finish."
                : "The first snapshot is pending. Use Refresh insights to check again."}
            </p>
          </section>
        ) : null}
        <TabsContent
          value="listening"
          forceMount
          hidden={tab !== "listening"}
          className={tab === "listening" ? undefined : "hidden"}
        >
          {data?.ready ? (
            <div className="grid min-w-0 gap-10" key={window}>
              <InsightSummary data={data} />
              <InsightTimeline data={data} />
              <InsightChanges data={data} />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent
          value="collection"
          forceMount
          hidden={tab !== "collection"}
          className={tab === "collection" ? undefined : "hidden"}
        >
          {data?.ready && visited.includes("collection") ? (
            <div className="grid min-w-0 gap-10" key={window}>
              <InsightComparison data={data} ruled={false} />
              <InsightOpportunities data={data} fullEnabled={fullEnabled} />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent
          value="sonic"
          forceMount
          hidden={tab !== "sonic"}
          className={tab === "sonic" ? undefined : "hidden"}
        >
          {data?.ready && visited.includes("sonic") ? (
            <div className="min-w-0" key={window}>
              <InsightSonicExplorer
                report={data.sonic}
                window={window}
                onRefresh={() => void refresh()}
                refreshing={refreshing}
                active={tab === "sonic"}
                ruled={false}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
