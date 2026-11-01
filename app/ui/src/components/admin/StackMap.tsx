import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Meter } from "@crate/ui/primitives/Meter";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import {
  getServiceRelations,
  layoutStackMap,
  orderStackMapInventory,
  serviceHealth,
  summarizeStack,
  type StackMapConnection,
  type StackMapField,
  type StackMapLink,
  type StackMapPoint,
  type StackMapSnapshot,
} from "./stack-map-model";
import {
  deriveStackActivity,
  type StackActivityFrame,
  type StackActivityView,
} from "./stack-map-activity";
import { useActivityPulses } from "./stack-map-pulses";
import "./stack-map.css";

const LIVE_LABELS: Record<StackActivityView["status"], string> = {
  live: "Live",
  partial: "Live · partial",
  warming: "Warming up",
  paused: "Paused",
  unavailable: "Live data unavailable",
};

type ConnectionKind = StackMapConnection["kind"];

const KINDS: ConnectionKind[] = ["request", "data", "queue", "telemetry"];
const DASHES: Record<ConnectionKind, string | undefined> = {
  request: undefined,
  data: "9 4",
  queue: "3 4",
  telemetry: "1 5",
};
const KIND_LEGEND: Record<ConnectionKind, string> = {
  request: "Requests",
  data: "Data",
  queue: "Queues",
  telemetry: "Telemetry",
};

interface Vector {
  x: number;
  y: number;
}

function polar(field: StackMapField, radius: number, angle: number): Vector {
  return {
    x: field.cx + Math.cos(angle) * radius,
    y: field.cy + Math.sin(angle) * radius * field.yScale,
  };
}

function toward(point: Vector, target: Vector, distance: number): Vector {
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return point;
  return {
    x: point.x + (dx / length) * distance,
    y: point.y + (dy / length) * distance,
  };
}

const format = (value: number) => value.toFixed(1);

function connectionPath(
  from: StackMapPoint,
  to: StackMapPoint,
  field: StackMapField | undefined,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let first: Vector;
  let second: Vector;
  if (!field || from.stackId !== to.stackId) {
    first = second = {
      x: (from.x + to.x) / 2 - dy * 0.16,
      y: (from.y + to.y) / 2 + dx * 0.16,
    };
  } else if (from.ring === "hub" || to.ring === "hub") {
    first = second = {
      x: (from.x + to.x) / 2 - dy * 0.07,
      y: (from.y + to.y) / 2 + dx * 0.07,
    };
  } else if (Math.abs(from.radius - to.radius) > 1) {
    const middle = (from.radius + to.radius) / 2;
    first = polar(field, middle, from.angle);
    second = polar(field, middle, to.angle);
  } else {
    first = second = polar(
      field,
      from.radius * 1.2,
      Math.atan2(
        Math.sin(from.angle) + Math.sin(to.angle),
        Math.cos(from.angle) + Math.cos(to.angle),
      ),
    );
  }
  const start = toward(from, first, from.ring === "hub" ? 14 : 8);
  const end = toward(to, second, to.ring === "hub" ? 16 : 10);
  return `M${format(start.x)} ${format(start.y)} C${format(first.x)} ${format(
    first.y,
  )} ${format(second.x)} ${format(second.y)} ${format(end.x)} ${format(end.y)}`;
}

function numeric(value: number | null, suffix: string, digits = 0) {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "n/a";
}

function DashSample({
  kind,
  length,
}: {
  kind: ConnectionKind;
  length: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${length} 2`}
      width={length}
      height={2}
      aria-hidden="true"
    >
      <line x1="0" y1="1" x2={length} y2="1" strokeDasharray={DASHES[kind]} />
    </svg>
  );
}

export function StackMap({
  snapshot,
  activity,
}: {
  snapshot: StackMapSnapshot;
  activity?: StackActivityFrame | null;
}) {
  const motionAllowed = useMotionAllowed();
  const pulseLayerRef = useRef<SVGGElement>(null);
  const pathRefs = useRef(new Map<StackMapConnection, SVGPathElement>());
  const liveEnabled = activity !== undefined;
  const activitySequence = activity?.sequence ?? null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!liveEnabled) return;
    setClock(Date.now());
    const timer = window.setTimeout(() => setClock(Date.now()), 15_500);
    return () => window.clearTimeout(timer);
  }, [liveEnabled, activitySequence]);
  const visualRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const prefix = useId().replace(/:/g, "");
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 880,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedServiceId, setFocusedServiceId] = useState<string | null>(null);
  const inventory = useMemo(() => orderStackMapInventory(snapshot), [snapshot]);
  const servicesById = useMemo(
    () => new Map(snapshot.services.map((service) => [service.id, service])),
    [snapshot.services],
  );
  const firstService = inventory.services[0];
  const defaultStack = inventory.stacks.find(
    (stack) => stack.id === firstService?.stackId,
  );
  const defaultId =
    defaultStack?.hubId &&
    servicesById.get(defaultStack.hubId)?.stackId === defaultStack.id
      ? defaultStack.hubId
      : firstService?.id;
  const selected =
    (selectedId ? servicesById.get(selectedId) : undefined) ??
    (defaultId ? servicesById.get(defaultId) : undefined);
  const previewId =
    [hoveredId, focusedServiceId].find((id) => id && servicesById.has(id)) ??
    null;
  const focusedId = previewId ?? selected?.id ?? "";
  const related = useMemo(
    () => getServiceRelations(snapshot, focusedId),
    [snapshot, focusedId],
  );
  const activeConnections = useMemo(
    () => new Set(related.connections),
    [related.connections],
  );
  const selection = useMemo(
    () => getServiceRelations(snapshot, selected?.id ?? ""),
    [snapshot, selected?.id],
  );
  const layout = useMemo(
    () =>
      layoutStackMap(
        compact
          ? {
              ...snapshot,
              stacks: snapshot.stacks.filter(
                (stack) => stack.id === selected?.stackId,
              ),
            }
          : snapshot,
        compact,
      ),
    [snapshot, compact, selected?.stackId],
  );
  const fieldsById = useMemo(
    () => new Map(layout.fields.map((field) => [field.id, field])),
    [layout.fields],
  );
  const summaries = useMemo(
    () =>
      new Map(
        snapshot.stacks.map((stack) => [
          stack.id,
          summarizeStack(snapshot, stack.id),
        ]),
      ),
    [snapshot],
  );
  let failing = 0;
  for (const summary of summaries.values()) failing += summary.failing;
  const observed = snapshot.availability === "available";
  const hasMetrics = observed && snapshot.metricsSource !== null;

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setCompact(entry.contentRect.width < 880);
    });
    observer.observe(visual);
    return () => observer.disconnect();
  }, []);

  function select(serviceId: string, focus = false) {
    setSelectedId(serviceId);
    setHoveredId(null);
    if (focus) {
      const node = nodeRefs.current.get(serviceId);
      if (node) node.focus();
      else
        window.requestAnimationFrame(
          () => nodeRefs.current.get(serviceId)?.focus(),
        );
    }
  }

  function relationList(title: string, links: StackMapLink[]) {
    return (
      <div className="stack-map__relations">
        <MonoLabel as="p">
          {title}{" "}
          <span className="stack-map__relation-count">{links.length}</span>
        </MonoLabel>
        {links.length ? (
          links.map(({ service, kinds }) => (
            <button
              key={service.id}
              type="button"
              aria-label={`Focus ${service.label}`}
              onClick={() => select(service.id, true)}
            >
              <span>{service.label}</span>
              <span className="stack-map__relation-kind">
                <DashSample kind={kinds[0]!} length={18} />
                {kinds.join(" · ")}
              </span>
            </button>
          ))
        ) : (
          <p className="stack-map__quiet">No declared connections</p>
        )}
      </div>
    );
  }

  const activityView = useMemo(
    () => deriveStackActivity(snapshot, activity ?? null, { now: clock }),
    [snapshot, activity, clock],
  );
  const liveConnections = useMemo(
    () => new Set(activityView.pulses.map((pulse) => pulse.connection)),
    [activityView.pulses],
  );
  useActivityPulses({
    layerRef: pulseLayerRef,
    pathRefs,
    pulses: activityView.pulses,
    sequence: activityView.sequence,
    enabled: liveEnabled && motionAllowed,
  });
  const liveReadings = selected
    ? activityView.readings.get(selected.id) ?? []
    : [];
  const health = selected ? serviceHealth(snapshot, selected) : "unknown";
  const selectedStack = snapshot.stacks.find(
    (stack) => stack.id === selected?.stackId,
  );
  return (
    <section
      className="stack-map"
      aria-label="Stack topology"
      data-motion={motionAllowed ? "on" : "off"}
      data-availability={snapshot.availability}
      data-preview={previewId ? "true" : "false"}
    >
      <header className="stack-map__host">
        <div className="stack-map__identity">
          <MonoLabel tone="accent">Host topology</MonoLabel>
          <h2>{snapshot.host.name}</h2>
          <p>
            {snapshot.host.address} <span>·</span> {snapshot.stacks.length}{" "}
            independent deployments <span>·</span> {snapshot.services.length}{" "}
            services
          </p>
        </div>
        <div className="stack-map__host-reading">
          <MonoLabel>Host CPU</MonoLabel>
          <strong>
            {numeric(hasMetrics ? snapshot.host.cpuPercent : null, "%", 1)}
          </strong>
        </div>
        <div className="stack-map__host-reading">
          <MonoLabel>Host memory</MonoLabel>
          <strong>
            {numeric(hasMetrics ? snapshot.host.memoryUsedGiB : null, "", 1)}
            <small> / {numeric(snapshot.host.memoryTotalGiB, " GiB")}</small>
          </strong>
        </div>
      </header>
      <div className="stack-map__layout">
        <div ref={visualRef} className="stack-map__visual">
          {compact && (
            <FormField
              kind="group"
              label="Deployment"
              className="stack-map__deployment"
            >
              <SegmentedControl
                as="radio"
                label="Deployment"
                value={selected?.stackId ?? inventory.stacks[0]?.id ?? ""}
                onValueChange={(stackId) => {
                  const stack = snapshot.stacks.find(
                    (candidate) => candidate.id === stackId,
                  );
                  const next =
                    (stack?.hubId
                      ? servicesById.get(stack.hubId)
                      : undefined) ??
                    inventory.services.find(
                      (service) => service.stackId === stackId,
                    );
                  if (next) select(next.id);
                }}
                items={inventory.stacks.map((stack) => ({
                  value: stack.id,
                  label: stack.name,
                }))}
              />
            </FormField>
          )}
          <div className="stack-map__toolbar">
            <InfoBadge tone={observed ? "accent" : "warning"}>
              {observed
                ? "Observed snapshot"
                : snapshot.availability === "stale"
                  ? "Stale snapshot"
                  : "Source unavailable"}
            </InfoBadge>
            {failing > 0 ? (
              <InfoBadge tone="danger">
                {failing} failing{" "}
                {failing === 1 ? "healthcheck" : "healthchecks"}
              </InfoBadge>
            ) : null}
            {liveEnabled ? (
              <InfoBadge
                tone={
                  activityView.status === "live"
                    ? "accent"
                    : activityView.status === "paused" ||
                        activityView.status === "unavailable"
                      ? "warning"
                      : "neutral"
                }
                data-live-status={activityView.status}
              >
                {LIVE_LABELS[activityView.status]}
                {activityView.status === "paused" && activity
                  ? ` · last ${new Date(
                      activity.observed_at,
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}`
                  : ""}
              </InfoBadge>
            ) : null}
          </div>
          <div
            className="stack-map__fields"
            style={{
              gridTemplateColumns: `repeat(${Math.max(
                1,
                layout.fields.length,
              )}, minmax(0, 1fr))`,
            }}
          >
            {layout.fields.map((field) => {
              const summary = summaries.get(field.id);
              return (
                <div
                  key={field.id}
                  className="stack-map__field-caption"
                  data-kind={field.kind}
                >
                  <h3>{field.name}</h3>
                  <p className="stack-map__field-count">
                    <strong>{summary?.total ?? 0}</strong>
                    <span>services · {field.revision}</span>
                  </p>
                  <p className="stack-map__field-health">
                    {summary?.observed ? (
                      <>
                        {summary.running} running <span>·</span>{" "}
                        {summary.passing} passing
                        {summary.failing ? (
                          <>
                            {" "}
                            <span>·</span>{" "}
                            <b data-health="unhealthy">
                              {summary.failing} failing
                            </b>
                          </>
                        ) : null}
                        {summary.unknown ? (
                          <>
                            {" "}
                            <span>·</span> {summary.unknown} unknown
                          </>
                        ) : null}
                      </>
                    ) : (
                      "Health unknown"
                    )}
                  </p>
                  {liveEnabled && field.kind === "application" ? (
                    <p
                      className="stack-map__field-live"
                      data-status={activityView.status}
                    >
                      {activityView.summary.requestsPerMinute ?? "—"} req/min{" "}
                      <span>·</span> {activityView.summary.listening ?? "—"}{" "}
                      listening <span>·</span>{" "}
                      {activityView.summary.tasks ?? "—"} tasks
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div
            className="stack-map__stage"
            data-compact={compact}
            style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
          >
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
              className="stack-map__wires"
            >
              <defs>
                {(["rest", "active"] as const).map((state) => (
                  <marker
                    key={state}
                    id={`${prefix}-arrow-${state}`}
                    className={`stack-map__arrow stack-map__arrow--${state}`}
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth={state === "active" ? 8 : 6}
                    markerHeight={state === "active" ? 8 : 6}
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M1 1 L7 4 L1 7" fill="none" strokeWidth="1.2" />
                  </marker>
                ))}
              </defs>
              {layout.fields.map((field) => {
                const ticks = field.outerRadius + (compact ? 16 : 26);
                const scale = field.yScale;
                return (
                  <g
                    key={field.id}
                    className="stack-map__field"
                    transform={`translate(${field.cx} ${field.cy})`}
                  >
                    <ellipse rx={34} ry={34} />
                    {field.innerRadius !== null ? (
                      <ellipse
                        rx={field.innerRadius}
                        ry={field.innerRadius * scale}
                        data-ring="inner"
                      />
                    ) : null}
                    <ellipse
                      rx={field.outerRadius}
                      ry={field.outerRadius * scale}
                      data-ring="outer"
                    />
                    <ellipse rx={ticks} ry={ticks * scale} />
                    <path
                      d={`M-${ticks + 12},0 H${ticks + 12} M0,-${format(
                        ticks * scale + 12,
                      )} V${format(ticks * scale + 12)}`}
                      strokeDasharray="1 7"
                    />
                    {Array.from({ length: 48 }, (_, tick) => {
                      const angle = (tick / 48) * Math.PI * 2;
                      const length = tick % 4 === 0 ? 7 : 3;
                      return (
                        <line
                          key={tick}
                          x1={format(Math.cos(angle) * ticks)}
                          y1={format(Math.sin(angle) * ticks * scale)}
                          x2={format(Math.cos(angle) * (ticks + length))}
                          y2={format(
                            Math.sin(angle) * (ticks + length) * scale,
                          )}
                        />
                      );
                    })}
                  </g>
                );
              })}
              {snapshot.connections.map((connection, index) => {
                const from = layout.nodes.get(connection.source);
                const to = layout.nodes.get(connection.target);
                if (
                  !from ||
                  !to ||
                  !servicesById.has(connection.source) ||
                  !servicesById.has(connection.target)
                )
                  return null;
                const active = activeConnections.has(connection);
                return (
                  <path
                    key={`${connection.source}-${connection.target}-${connection.kind}-${index}`}
                    d={connectionPath(from, to, fieldsById.get(from.stackId))}
                    ref={(node) => {
                      if (node) pathRefs.current.set(connection, node);
                      else pathRefs.current.delete(connection);
                    }}
                    className="stack-map__connection"
                    data-live={liveConnections.has(connection)}
                    data-active={active}
                    data-muted={Boolean(previewId) && !active}
                    data-kind={connection.kind}
                    data-cross-stack={from.stackId !== to.stackId}
                    strokeDasharray={DASHES[connection.kind]}
                    markerEnd={`url(#${prefix}-arrow-${
                      active ? "active" : "rest"
                    })`}
                  />
                );
              })}
              {[...activityView.levels].map(([serviceId, value]) => {
                const point = layout.nodes.get(serviceId);
                if (!point || value <= 0) return null;
                return (
                  <circle
                    key={`level-${serviceId}`}
                    className="stack-map__level"
                    data-service={serviceId}
                    data-paused={activityView.status === "paused"}
                    cx={point.x}
                    cy={point.y}
                    r={point.ring === "hub" ? 24 : 16}
                    pathLength={100}
                    strokeDasharray={`${Math.max(4, value * 100).toFixed(
                      1,
                    )} 100`}
                    transform={`rotate(-90 ${point.x} ${point.y})`}
                  />
                );
              })}
              <g ref={pulseLayerRef} className="stack-map__pulses" />
            </svg>
            {inventory.services.map((service) => {
              const point = layout.nodes.get(service.id);
              if (!point) return null;
              const active = related.activeIds.has(service.id);
              const state = serviceHealth(snapshot, service);
              const runtime = observed ? service.runtimeState : "unknown";
              const word = !observed
                ? null
                : state === "unhealthy"
                  ? "failing"
                  : runtime !== "running"
                    ? runtime
                    : null;
              return (
                <button
                  key={service.id}
                  ref={(node) => {
                    if (node) nodeRefs.current.set(service.id, node);
                    else nodeRefs.current.delete(service.id);
                  }}
                  type="button"
                  aria-label={`Inspect ${service.label}`}
                  aria-pressed={selected?.id === service.id}
                  data-active={active}
                  data-dimmed={Boolean(previewId) && !active}
                  data-selected={selected?.id === service.id}
                  data-health={state}
                  data-runtime={runtime}
                  data-hub={point.ring === "hub"}
                  data-ring={point.ring}
                  data-label={point.label}
                  className="stack-map__node"
                  style={{
                    left: `${(point.x / layout.width) * 100}%`,
                    top: `${(point.y / layout.height) * 100}%`,
                  }}
                  onPointerEnter={() => setHoveredId(service.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  onFocus={() => setFocusedServiceId(service.id)}
                  onBlur={() => setFocusedServiceId(null)}
                  onClick={() => select(service.id)}
                  onKeyDown={(event) => {
                    if (
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const order = fieldsById.get(point.stackId)?.order ?? [];
                    const index = order.indexOf(service.id);
                    const offset =
                      event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? -1
                        : 1;
                    const next =
                      order[(index + offset + order.length) % order.length];
                    if (next) nodeRefs.current.get(next)?.focus();
                  }}
                >
                  <span className="stack-map__node-ring" aria-hidden="true" />
                  <span className="stack-map__node-core" aria-hidden="true" />
                  <span className="stack-map__node-label">
                    {service.label}
                    {word ? (
                      <span className="stack-map__node-state">{word}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <section
          className="stack-map__inspector"
          aria-label="Service inspector"
        >
          {selected ? (
            <>
              <MonoLabel tone="accent">Selected service</MonoLabel>
              <h3>{selected.label}</h3>
              <p className="stack-map__description">{selected.description}</p>
              <div className="stack-map__service-state">
                <InfoBadge tone={health === "unhealthy" ? "danger" : "neutral"}>
                  {observed ? selected.runtimeState : "State unknown"}
                </InfoBadge>
                <span data-health={health}>
                  {health === "healthy"
                    ? "Healthcheck passed"
                    : health === "unhealthy"
                      ? "Healthcheck failed"
                      : "Healthcheck unknown"}
                </span>
              </div>
              <div className="stack-map__service-readings">
                <Meter
                  label="CPU"
                  value={hasMetrics ? selected.cpuPercent : null}
                  max={100}
                  valueText={numeric(selected.cpuPercent, "%", 1)}
                />
                <Meter
                  label="Memory"
                  value={hasMetrics ? selected.memoryMiB : null}
                  max={
                    snapshot.host.memoryTotalGiB !== null
                      ? snapshot.host.memoryTotalGiB * 1024
                      : 0
                  }
                  valueText={numeric(selected.memoryMiB, " MiB")}
                />
              </div>
              <dl className="stack-map__metadata">
                <div>
                  <dt>Service</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>Deployment</dt>
                  <dd>{selectedStack?.name ?? "Unclassified"}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{selectedStack?.revision ?? "Unknown"}</dd>
                </div>
              </dl>
              {snapshot.links?.grafana ? (
                <a
                  className="stack-map__grafana"
                  href={`${snapshot.links.grafana}/d/${
                    selected.tier === "data"
                      ? "crate-infra-data"
                      : "crate-infra-runtime"
                  }?from=now-1h&to=now`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${selected.label} in Grafana`}
                >
                  Open in Grafana
                </a>
              ) : null}
              {liveEnabled ? (
                <div
                  className="stack-map__live"
                  data-status={activityView.status}
                >
                  <MonoLabel as="p">Live activity</MonoLabel>
                  {liveReadings.length ? (
                    <dl>
                      {liveReadings.map((reading) => (
                        <div key={reading.label}>
                          <dt>{reading.label}</dt>
                          <dd>{reading.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="stack-map__quiet">
                      {activityView.status === "unavailable"
                        ? "Live data unavailable"
                        : activityView.status === "warming"
                          ? "Collecting the first window"
                          : "No attributed activity in the last window"}
                    </p>
                  )}
                </div>
              ) : null}
              {relationList("Depends on", selection.outgoingLinks)}
              {relationList("Used by", selection.incomingLinks)}
              <p className="stack-map__source">
                {snapshot.metricsSource
                  ? "Prometheus"
                  : "Metrics source unavailable"}{" "}
                <span>·</span> {snapshot.availability}
                <br />
                {snapshot.observedAt
                  ? `Observed ${new Date(
                      snapshot.observedAt,
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}`
                  : "Observation time unavailable"}
              </p>
            </>
          ) : (
            <p className="stack-map__quiet">No service inventory available</p>
          )}
        </section>
        <div className="stack-map__legend" aria-label="Map key">
          <span className="stack-map__legend-title">
            Declared dependencies · arrows point to the dependency
          </span>
          {KINDS.map((kind) => (
            <span key={kind}>
              <DashSample kind={kind} length={24} />
              {KIND_LEGEND[kind]}
            </span>
          ))}
          {(["healthy", "unhealthy", "unknown"] as const).map((state) => (
            <span key={state}>
              <i data-health={state} aria-hidden="true" />
              {state === "healthy"
                ? "Passing"
                : state === "unhealthy"
                  ? "Failing"
                  : "Unknown"}
            </span>
          ))}
        </div>
        <details className="stack-map__list">
          <summary>
            Service index <span>{snapshot.services.length}</span>
          </summary>
          <div className="stack-map__list-groups">
            {inventory.stacks.map((stack) => {
              const members = inventory.services.filter(
                (service) => service.stackId === stack.id,
              );
              if (!members.length) return null;
              return (
                <section
                  key={stack.id}
                  role="group"
                  aria-label={`${stack.name} services`}
                  className="stack-map__list-group"
                  data-kind={stack.kind}
                >
                  <h4 className="stack-map__list-heading">
                    <MonoLabel as="span">
                      <i
                        className="stack-map__stack-mark"
                        data-kind={stack.kind}
                        aria-hidden="true"
                      />
                      {stack.name}
                      <span>{members.length}</span>
                    </MonoLabel>
                  </h4>
                  <div className="stack-map__list-items">
                    {members.map((service) => (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => select(service.id, true)}
                        aria-label={`Select ${service.label} from index`}
                      >
                        <span className="stack-map__list-name">
                          <i
                            className="stack-map__stack-mark"
                            data-kind={stack.kind}
                            aria-hidden="true"
                          />
                          {service.label}
                        </span>
                        <span>
                          {observed ? service.runtimeState : "unknown"}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </details>
      </div>
    </section>
  );
}
