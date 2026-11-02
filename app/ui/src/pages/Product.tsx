import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { useInstrumentChartTheme } from "@/components/charts/InstrumentChart";
import {
  KPI_CATALOGUE,
  KPI_GROUPS,
  breakdownRows,
  dailyValues,
  formatChange,
  formatKpiValue,
  summarizeKpi,
  type KpiDefinition,
  type ProductKpiResponse,
} from "@/components/product/product-kpi-model";
import { PageHeaderActions } from "@/components/layout/PageHeader";
import { useApi } from "@/hooks/use-api";

const WINDOWS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "1y" },
];

function KpiBreakdown({
  definition,
  data,
}: {
  definition: KpiDefinition;
  data: ProductKpiResponse;
}) {
  const rows = breakdownRows(definition, data);
  if (!rows.length) return null;
  return (
    <section aria-label={definition.label} className="space-y-3">
      <MonoLabel as="h3">{definition.label}</MonoLabel>
      <div className="space-y-3">
        {rows.map((row) =>
          row.hidden ? (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3"
            >
              <MonoLabel as="span">{row.label}</MonoLabel>
              <span className="text-xs text-text-muted">
                {`Hidden, fewer than ${data.minimum_sample} listeners`}
              </span>
            </div>
          ) : (
            <Meter
              key={row.label}
              label={row.label}
              value={row.share}
              max={1}
              valueText={`${formatKpiValue(row.value, definition.unit)} · ${formatKpiValue(row.share, "ratio")}`}
            />
          ),
        )}
      </div>
    </section>
  );
}

function PlaysTrend({ data }: { data: ProductKpiResponse }) {
  const { colors, theme } = useInstrumentChartTheme();
  const motionAllowed = useMotionAllowed();
  const points = dailyValues("listening.plays", data);
  if (points.length < 2) return null;
  return (
    <figure aria-label="Plays per day" className="space-y-2">
      <MonoLabel as="figcaption">Plays per day</MonoLabel>
      <div className="h-44" data-testid="product-plays-trend">
        <ResponsiveLine
          data={[
            {
              id: "Plays",
              data: points.map((point) => ({ x: point.day, y: point.value })),
            },
          ]}
          theme={theme}
          colors={[colors.accent]}
          margin={{ top: 12, right: 44, bottom: 28, left: 44 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          axisBottom={{
            tickValues: [points[0]!.day, points[points.length - 1]!.day],
          }}
          axisLeft={{ tickValues: 4 }}
          enableGridX={false}
          pointSize={0}
          useMesh
          animate={motionAllowed}
        />
      </div>
    </figure>
  );
}

export function Product() {
  const [days, setDays] = useState("30");
  const { data, loading, error, refetch } = useApi<ProductKpiResponse>(
    `/api/admin/kpis?days=${days}`,
  );
  const readings = useMemo(
    () =>
      data
        ? new Map(
            KPI_CATALOGUE.map((definition) => [
              definition.kpi,
              summarizeKpi(definition, data),
            ]),
          )
        : new Map(),
    [data],
  );

  if (!data && loading) return <LoadingState label="Loading product KPIs" />;
  if (!data && error)
    return (
      <ErrorState message="Could not load product KPIs." onRetry={refetch} />
    );

  const computed = data?.computed_at ? new Date(data.computed_at) : null;
  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Product"
        description="Instance-wide product figures computed hourly from listening rollups and activity. Aggregates only, never individual listeners."
        compactActions
        actions={
          <PageHeaderActions>
            <SegmentedControl
              as="radio"
              label="KPI window"
              value={days}
              onValueChange={setDays}
              items={WINDOWS}
            />
          </PageHeaderActions>
        }
      >
        <InfoBadge tone={computed ? "accent" : "warning"}>
          {computed
            ? `Computed ${computed.toISOString().slice(0, 16).replace("T", " ")} UTC`
            : "Not computed yet"}
        </InfoBadge>
        {data ? (
          <InfoBadge>{`Segments under ${data.minimum_sample} listeners hidden`}</InfoBadge>
        ) : null}
      </OpsPageHero>
      {data && !computed ? (
        <EmptyState
          title="No product KPIs yet"
          description="The hourly KPI job has not written any days. The first run backfills up to a year from the listening history."
        />
      ) : null}
      {data && computed
        ? KPI_GROUPS.map((group) => {
            const definitions = KPI_CATALOGUE.filter(
              (item) => item.group === group.id,
            );
            return (
              <OpsPanel
                key={group.id}
                title={group.title}
                description={group.description}
              >
                <div className="space-y-6">
                  {group.id === "listening" ? <PlaysTrend data={data} /> : null}
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {definitions
                      .filter((definition) => definition.tile !== false)
                      .map((definition) => {
                        const reading = readings.get(definition.kpi)!;
                        return (
                          <OpsStatTile
                            key={definition.kpi}
                            label={definition.label}
                            value={formatKpiValue(
                              reading.value,
                              definition.unit,
                            )}
                            caption={
                              <span className="block space-y-1">
                                <span className="block">
                                  {formatChange(reading, data.window_days)}
                                </span>
                                {definition.caption ? (
                                  <span className="block">
                                    {definition.caption}
                                  </span>
                                ) : null}
                              </span>
                            }
                          />
                        );
                      })}
                  </div>
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    {definitions
                      .filter((definition) => definition.breakdown)
                      .map((definition) => (
                        <KpiBreakdown
                          key={definition.kpi}
                          definition={definition}
                          data={data}
                        />
                      ))}
                  </div>
                </div>
              </OpsPanel>
            );
          })
        : null}
      <p className="text-xs text-text-muted">
        Listening figures use each listener&apos;s local day; signups,
        engagement, acquisition and streams use UTC days. Library, device and
        peer figures describe the instance when they were computed.
      </p>
    </div>
  );
}
