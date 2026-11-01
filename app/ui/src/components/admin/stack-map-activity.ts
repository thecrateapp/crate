import type {
  StackMapConnection,
  StackMapService,
  StackMapSnapshot,
} from "./stack-map-model";

export interface StackActivityFrame {
  schema: 1;
  sequence: number;
  observed_at: string;
  window_seconds: number | null;
  availability: "available" | "partial" | "warming" | "unavailable";
  requests: Record<string, { count: number; errors: number }> | null;
  queues: Record<string, { completed: number; failed: number }> | null;
  projector: { events: number } | null;
  listening: number | null;
  sources: Record<string, string>;
}

export interface StackActivityReading {
  label: string;
  value: string;
}

export interface StackActivityPulse {
  connection: StackMapConnection;
  count: number;
  errors: number;
  dots: number;
  reverse: boolean;
}

export interface StackActivityView {
  status: "live" | "warming" | "partial" | "paused" | "unavailable";
  sequence: number | null;
  ageSeconds: number | null;
  readings: Map<string, StackActivityReading[]>;
  levels: Map<string, number>;
  pulses: StackActivityPulse[];
  summary: {
    requestsPerMinute: number | null;
    listening: number | null;
    tasks: number | null;
  };
}

const MAX_DOTS_PER_EDGE = 3;
const MAX_DOTS = 40;

const perMinute = (count: number, window: number) =>
  Math.round((count / window) * 60);

const level = (value: number, decades: number) =>
  Math.max(0, Math.min(1, Math.log10(1 + value) / decades));

const dotsFor = (count: number) =>
  Math.min(MAX_DOTS_PER_EDGE, Math.ceil(Math.log2(1 + count)));

const taskValue = (completed: number, failed: number) =>
  `${completed + failed} tasks${failed ? ` · ${failed} failed` : ""}`;

function measuring(
  services: StackMapService[],
  measure: "requests" | "events" | "listening",
) {
  return services.filter(
    (service) => service.activity?.measures?.includes(measure),
  );
}

export function deriveStackActivity(
  snapshot: StackMapSnapshot,
  frame: StackActivityFrame | null,
  { now, staleAfterMs = 15_000 }: { now: number; staleAfterMs?: number },
): StackActivityView {
  const readings = new Map<string, StackActivityReading[]>();
  const levels = new Map<string, number>();
  const pulses: StackActivityPulse[] = [];
  const view: StackActivityView = {
    status: "unavailable",
    sequence: frame?.sequence ?? null,
    ageSeconds: null,
    readings,
    levels,
    pulses,
    summary: { requestsPerMinute: null, listening: null, tasks: null },
  };
  if (!frame || frame.availability === "unavailable") return view;

  const observed = Date.parse(frame.observed_at);
  const age = Number.isFinite(observed) ? now - observed : Infinity;
  view.ageSeconds = Number.isFinite(age)
    ? Math.max(0, Math.round(age / 1000))
    : null;
  const paused = age > staleAfterMs;
  view.status = paused
    ? "paused"
    : frame.availability === "warming"
      ? "warming"
      : frame.availability === "partial"
        ? "partial"
        : "live";

  const add = (serviceId: string, reading: StackActivityReading) =>
    readings.set(serviceId, [...(readings.get(serviceId) ?? []), reading]);
  const raise = (serviceId: string, value: number) =>
    levels.set(serviceId, Math.max(levels.get(serviceId) ?? 0, value));
  const connection = (
    predicate: (item: StackMapConnection) => boolean,
  ): StackMapConnection | undefined => snapshot.connections.find(predicate);
  const window = frame.window_seconds;
  const services = snapshot.services;

  for (const service of measuring(services, "listening")) {
    if (frame.listening === null) continue;
    add(service.id, { label: "Listening", value: String(frame.listening) });
    raise(service.id, level(frame.listening, 2));
  }
  view.summary.listening = frame.listening;

  if (frame.requests && window) {
    const measurers = measuring(services, "requests");
    let total = 0;
    let errors = 0;
    for (const [client, entry] of Object.entries(frame.requests)) {
      total += entry.count;
      errors += entry.errors;
      const origins = services.filter(
        (service) => service.activity?.clients?.includes(client),
      );
      if (origins.length !== 1) continue;
      const origin = origins[0]!;
      add(origin.id, {
        label: "Requests",
        value: `${perMinute(entry.count, window)}/min`,
      });
      raise(origin.id, level(perMinute(entry.count, window), 3));
      for (const measurer of measurers) {
        const link = connection(
          (item) => item.source === origin.id && item.target === measurer.id,
        );
        if (link && entry.count > 0)
          pulses.push({
            connection: link,
            count: entry.count,
            errors: entry.errors,
            dots: dotsFor(entry.count),
            reverse: false,
          });
      }
    }
    const rate = perMinute(total, window);
    view.summary.requestsPerMinute = rate;
    for (const measurer of measurers) {
      add(measurer.id, { label: "Requests", value: `${rate}/min` });
      if (errors) add(measurer.id, { label: "Errors", value: String(errors) });
      raise(measurer.id, level(rate, 3));
    }
  }

  if (frame.queues && window) {
    let tasks = 0;
    for (const [queue, entry] of Object.entries(frame.queues)) {
      const count = entry.completed + entry.failed;
      tasks += count;
      if (!count) continue;
      const consumers = services.filter(
        (service) => service.activity?.queues?.includes(queue),
      );
      const links = consumers
        .map((consumer) =>
          connection(
            (item) => item.source === consumer.id && item.kind === "queue",
          ),
        )
        .filter((item): item is StackMapConnection => Boolean(item));
      if (consumers.length === 1 && links.length === 1) {
        const consumer = consumers[0]!;
        add(consumer.id, {
          label: queue,
          value: taskValue(entry.completed, entry.failed),
        });
        raise(consumer.id, level(perMinute(count, window), 2));
        pulses.push({
          connection: links[0]!,
          count,
          errors: entry.failed,
          dots: dotsFor(count),
          reverse: true,
        });
      } else if (links.length) {
        const store = links[0]!.target;
        add(store, {
          label: queue,
          value: taskValue(entry.completed, entry.failed),
        });
        raise(store, level(perMinute(count, window), 2));
      }
    }
    view.summary.tasks = tasks;
  }

  if (frame.projector) {
    for (const projector of measuring(services, "events")) {
      add(projector.id, {
        label: "Events",
        value: String(frame.projector.events),
      });
      if (window)
        raise(
          projector.id,
          level(perMinute(frame.projector.events, window), 2),
        );
      if (!frame.projector.events) continue;
      for (const link of snapshot.connections) {
        if (link.source !== projector.id) continue;
        if (link.kind !== "queue" && link.kind !== "data") continue;
        pulses.push({
          connection: link,
          count: frame.projector.events,
          errors: 0,
          dots: dotsFor(frame.projector.events),
          reverse: link.kind === "queue",
        });
      }
    }
  }

  if (paused || view.status === "warming") {
    view.pulses = [];
    return view;
  }
  pulses.sort((a, b) => b.count - a.count);
  let budget = MAX_DOTS;
  for (const item of pulses) {
    item.dots = Math.min(item.dots, budget);
    budget -= item.dots;
  }
  view.pulses = pulses.filter((item) => item.dots > 0);
  return view;
}
