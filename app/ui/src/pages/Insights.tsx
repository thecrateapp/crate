import { useState } from "react";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@crate/ui/composites/AdminSelect";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
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
import {
  InsightChanges,
  InsightOpportunities,
} from "@/components/insights/InsightEntityLists";
import {
  minutes,
  number,
  type InsightsWindow,
} from "@/components/insights/insights-model";

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
  return (
    <div className="min-w-0 space-y-10">
      <OpsPageHero
        title="Insights"
        description="Listening and curation across your indexed collection."
        compactActions
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <AdminSelect
              placeholder="Period"
              ariaLabel="Period"
              allowClear={false}
              value={window}
              onChange={changeWindow}
              options={[
                { value: "30d", label: "30 days" },
                { value: "90d", label: "90 days" },
                { value: "365d", label: "Year" },
              ]}
            />
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
          <div className="space-y-2">
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
      {error ? (
        <div role="status" className="space-y-2 text-sm text-text-muted">
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
        <section aria-label="Insights pending" className="space-y-3">
          <h2 className="font-display text-lg">Insights are being prepared</h2>
          <p className="text-sm text-text-muted">
            {refreshing
              ? "Waiting for the collection snapshot to finish."
              : "The first snapshot is pending. Use Refresh insights to check again."}
          </p>
        </section>
      ) : null}
      {data?.ready ? (
        <div className="space-y-10" key={window}>
          <InsightSummary data={data} />
          <InsightComparison data={data} />
          <InsightTimeline data={data} />
          <InsightChanges data={data} />
          <InsightOpportunities data={data} fullEnabled={fullEnabled} />
        </div>
      ) : null}
    </div>
  );
}
