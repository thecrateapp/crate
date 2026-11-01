export type MetricField = "avg" | "max" | "count";
export interface MetricReadStatus {
  source?: string;
  availability?: string;
  reason?: string | null;
  observed_at?: string | null;
  age_seconds?: number | null;
  window_minutes?: number;
}
export interface MetricSample {
  source_gap?: boolean;
  timestamp: string;
  count?: number | null;
  avg?: number | null;
  max?: number | null;
}
export interface MetricStream {
  id: string;
  title: string;
  unit: string;
  fields: MetricField[];
  warning?: boolean;
}
export const metricStreams: MetricStream[] = [
  {
    id: "api.latency",
    title: "API Latency",
    unit: "ms",
    fields: ["avg", "max"],
  },
  {
    id: "api.requests",
    title: "Request Volume",
    unit: "requests per interval",
    fields: ["count"],
  },
  {
    id: "api.errors",
    title: "Errors (5xx)",
    unit: "errors per interval",
    fields: ["count"],
    warning: true,
  },
  {
    id: "api.slow",
    title: "Slow Requests",
    unit: "requests at least 1,000 ms per interval",
    fields: ["count"],
  },
  {
    id: "stream.requests",
    title: "Stream Requests",
    unit: "requests per interval, including SSE",
    fields: ["count"],
  },
  {
    id: "stream.transcode.duration",
    title: "Transcode Duration",
    unit: "seconds",
    fields: ["avg", "max"],
  },
  {
    id: "home.compute.ms",
    title: "Home Core Compute",
    unit: "ms",
    fields: ["avg", "max"],
  },
  {
    id: "home.endpoint_compute.ms",
    title: "Home Endpoint Compute",
    unit: "ms",
    fields: ["avg", "max"],
  },
  {
    id: "worker.task.duration",
    title: "Task Duration",
    unit: "seconds",
    fields: ["avg", "max"],
  },
  {
    id: "worker.queue.wait",
    title: "Queue Wait Time",
    unit: "seconds",
    fields: ["avg", "max"],
  },
  {
    id: "worker.queue.depth",
    title: "Queue Depth",
    unit: "observed tasks",
    fields: ["avg", "max"],
  },
  {
    id: "worker.resource.deferred",
    title: "Resource Deferrals",
    unit: "deferrals per interval",
    fields: ["count"],
  },
  {
    id: "worker.resource.load_ratio",
    title: "Load Ratio at Deferral",
    unit: "ratio observed when work is deferred",
    fields: ["avg", "max"],
  },
];
export const metricFieldLabel = (field: MetricField) =>
  ({ avg: "Average", max: "Maximum", count: "Count" })[field];
export function buildMetricSeries(
  data: MetricSample[],
  fields: MetricField[],
  intervalSeconds: number,
) {
  const sorted = data
    .map((sample) => ({ sample, time: Date.parse(sample.timestamp) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time);
  return fields.map((field) => {
    const points: { x: number; y: number | null }[] = [];
    sorted.forEach(({ sample, time }, index) => {
      const previous = sorted[index - 1]?.time;
      if (previous != null && time - previous > intervalSeconds * 1000)
        points.push({ x: previous + intervalSeconds * 1000, y: null });
      const value = sample[field];
      points.push({
        x: time,
        y:
          !sample.source_gap &&
          typeof value === "number" &&
          Number.isFinite(value)
            ? value
            : null,
      });
    });
    return { id: field, data: points };
  });
}
