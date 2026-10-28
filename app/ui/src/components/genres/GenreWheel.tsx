import { useCallback, useEffect, useId, useMemo, useState } from "react";
import "./genre-wheel.css";

import { OpsRefreshNotice } from "@/components/admin/ops-surfaces";
import { useApi } from "@/hooks/use-api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";
import {
  buildLocalGenreWheelModel,
  buildGenreWheelModel,
  formatGenreWheelGain,
  resolveGenreWheelEqPath,
  resolveOverlayCoreTargets,
  type GenreWheelTaxonomyNode,
} from "@/components/genres/genre-wheel-model";

export interface GenreWheelTaxonomyResponse {
  nodes: GenreWheelTaxonomyNode[];
  top_level_slugs: string[];
  core_taxonomy?: {
    taxonomy_id: string;
    version: string;
    digest: string;
    signature_valid: boolean;
    key_id: string | null;
  };
}

interface GenreWheelProps {
  filter?: string;
  onUnsupported?: () => void;
  taxonomyData?: GenreWheelTaxonomyResponse | null;
  onRefetch?: () => void;
  selectedSlug?: string | null;
  onSelectGenre?: (slug: string) => void;
  layout?: "global" | "embedded";
}

const CENTER = 380;
const FALLBACK_EQ_WALK = [
  "powerviolence",
  "post-punk",
  "funk",
  "thrash-metal",
  "techno",
  "gothic-rock",
  "crust-punk",
];
const EQ_BANDS = [
  "32",
  "64",
  "125",
  "250",
  "500",
  "1K",
  "2K",
  "4K",
  "8K",
  "16K",
];
const label = (slug: string) => slug.replace(/-/g, " ");
const point = (radius: number, angle: number) => ({
  x: CENTER + Math.cos(angle - Math.PI / 2) * radius,
  y: CENTER + Math.sin(angle - Math.PI / 2) * radius,
});
const number = (value: number) => value.toFixed(1);

function parentPath(
  slug: string,
  parent: string,
  positions: Map<
    string,
    { x: number; y: number; radius: number; angle: number }
  >,
) {
  const childNode = positions.get(slug);
  const parentNode = positions.get(parent);
  if (!childNode || !parentNode) return "";
  const mid = (childNode.radius + parentNode.radius) / 2;
  const controlA = point(mid, parentNode.angle);
  const controlB = point(mid, childNode.angle);
  return `M${number(parentNode.x)} ${number(parentNode.y)} C${number(controlA.x)} ${number(controlA.y)} ${number(controlB.x)} ${number(controlB.y)} ${number(childNode.x)} ${number(childNode.y)}`;
}

function relatedPath(
  pair: string,
  positions: Map<string, { x: number; y: number }>,
) {
  const [aSlug, bSlug] = pair.split("|");
  const a = positions.get(aSlug!);
  const b = positions.get(bSlug!);
  if (!a || !b) return "";
  const control = {
    x: CENTER + ((a.x + b.x) / 2 - CENTER) * 0.18,
    y: CENTER + ((a.y + b.y) / 2 - CENTER) * 0.18,
  };
  return `M${number(a.x)} ${number(a.y)} Q${number(control.x)} ${number(control.y)} ${number(b.x)} ${number(b.y)}`;
}

const RELATION_STYLES = {
  influence: { color: "#a78bfa", dash: "5 4" },
  fusion: { color: "#fb7185", dash: "2 4" },
} as const;

export function GenreWheel({
  onUnsupported,
  taxonomyData,
  onRefetch,
  selectedSlug: controlledSelectedSlug,
  onSelectGenre,
  layout = "global",
}: GenreWheelProps) {
  const markerPrefix = useId().replace(/:/g, "");
  const markerIds = {
    parent: `${markerPrefix}-parent-arrow`,
    influence: `${markerPrefix}-influence-arrow`,
    fusion: `${markerPrefix}-fusion-arrow`,
  };
  const hasExternalData = taxonomyData !== undefined;
  const taxonomyApi = useApi<GenreWheelTaxonomyResponse>(
    hasExternalData ? null : "/api/genres/taxonomy/tree",
  );
  const data = hasExternalData ? taxonomyData : taxonomyApi.data;
  const loading = hasExternalData ? false : taxonomyApi.loading;
  const error = hasExternalData ? null : taxonomyApi.error;
  const refetch = onRefetch ?? taxonomyApi.refetch;
  const [internalSelectedSlug, setInternalSelectedSlug] = useState<
    string | null
  >(null);
  const selectedSlug =
    controlledSelectedSlug === undefined
      ? internalSelectedSlug
      : controlledSelectedSlug;
  const model = useMemo(
    () => buildGenreWheelModel(data?.nodes ?? []),
    [data?.nodes],
  );
  const hasCoreTaxonomy = Boolean(
    data?.core_taxonomy && data.nodes.some((node) => node.origin === "core"),
  );
  const nodesBySlug = useMemo(
    () => new Map(model.nodes.map((node) => [node.slug, node])),
    [model.nodes],
  );
  const selectedTaxonomyNode = selectedSlug
    ? data?.nodes.find((node) => node.slug === selectedSlug)
    : undefined;
  const overlayCoreTargets = useMemo(() => {
    if (!selectedTaxonomyNode || selectedTaxonomyNode.origin === "core")
      return [];
    return resolveOverlayCoreTargets(selectedTaxonomyNode, data?.nodes ?? []);
  }, [data?.nodes, selectedTaxonomyNode]);
  const localModel = useMemo(
    () =>
      layout === "embedded" && selectedSlug
        ? buildLocalGenreWheelModel(data?.nodes ?? [], selectedSlug)
        : null,
    [data?.nodes, layout, selectedSlug],
  );
  const displayModel = localModel ?? model;
  const localMode = localModel !== null;
  const walkSlugs = useMemo(() => {
    const inherited = (slug: string) =>
      model.nodes.some(
        (node) =>
          node.slug === slug &&
          node.eq_preset_source === "inherited" &&
          !!node.eq_gains,
      );
    const curated = FALLBACK_EQ_WALK.filter(inherited);
    if (curated.length) return curated;
    return model.nodes
      .filter(
        (node) => node.eq_preset_source === "inherited" && !!node.eq_gains,
      )
      .slice(0, 7)
      .map((node) => node.slug);
  }, [model.nodes]);
  const selected =
    selectedTaxonomyNode ??
    (selectedSlug ? nodesBySlug.get(selectedSlug) : undefined);
  const activeSlug = localMode
    ? (selected?.slug ?? null)
    : selected?.origin === "core"
      ? selected.slug
      : (overlayCoreTargets[0] ?? null);
  const path = selected
    ? resolveGenreWheelEqPath(selected, data?.nodes ?? model.nodes)
    : [];
  const sourceSlug = selected
    ? selected.eq_preset_source === "direct"
      ? selected.slug
      : selected.eq_preset_inherited_from
    : null;
  const selectedGains = selected?.eq_gains ?? [];
  const highlightedSlugs = useMemo(() => {
    const highlighted = new Set<string>();
    if (localModel) {
      for (const slug of [
        localModel.focusSlug,
        ...(localModel.directSlugs ?? []),
      ]) {
        if (slug) highlighted.add(slug);
      }
      return highlighted;
    }
    const focusNodes = selected
      ? selected.origin === "core"
        ? [selected]
        : []
      : overlayCoreTargets
          .map((slug) => nodesBySlug.get(slug))
          .filter((node): node is GenreWheelTaxonomyNode => Boolean(node));
    if (selected?.origin !== "core" && selected) {
      for (const slug of overlayCoreTargets) highlighted.add(slug);
      return highlighted;
    }
    if (!focusNodes.length) return highlighted;
    for (const focus of focusNodes) highlighted.add(focus.slug);
    // Overlay genres are not nodes in the signed core wheel. Show only the
    // core nodes directly resolved from that overlay; expanding each target's
    // neighborhood makes the wheel disagree with the overlay summary.
    if (!selected) return highlighted;

    const add = (slug?: string) => {
      if (slug && nodesBySlug.has(slug)) highlighted.add(slug);
    };
    for (const focus of focusNodes) {
      for (const slug of [
        ...(focus.parent_slugs ?? []),
        ...(focus.children_slugs ?? []),
        ...(focus.related_slugs ?? []),
        ...(focus.influenced_by_slugs ?? []),
        ...(focus.influences_slugs ?? []),
        ...(focus.fusion_of_slugs ?? []),
        ...(focus.fusion_genre_slugs ?? []),
      ]) {
        add(slug);
      }
      for (const node of model.nodes) {
        if (node.parent_slugs.some((parent) => parent === focus.slug)) {
          add(node.slug);
        }
        if (
          focus.parent_slugs.some((parent) =>
            node.parent_slugs.includes(parent),
          )
        ) {
          add(node.slug);
        }
      }
    }
    return highlighted;
  }, [localModel, model.nodes, nodesBySlug, overlayCoreTargets, selected]);

  const choose = useCallback(
    (slug: string) => {
      if (controlledSelectedSlug === undefined) setInternalSelectedSlug(slug);
      onSelectGenre?.(slug);
    },
    [controlledSelectedSlug, onSelectGenre],
  );

  useEffect(() => {
    if (data && !hasCoreTaxonomy) onUnsupported?.();
  }, [data, hasCoreTaxonomy, onUnsupported]);

  if (error && !data) {
    return (
      <OpsRefreshNotice
        message="Could not load the core genre wheel. Try again."
        onRetry={refetch}
      />
    );
  }
  if (loading && !data) {
    return (
      <div
        className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"
        role="status"
      >
        Loading the core taxonomy…
      </div>
    );
  }
  if (displayModel.nodes.length === 0) {
    return (
      <div className="py-3 text-sm text-text-muted" role="status">
        Core taxonomy data is unavailable.
      </div>
    );
  }

  // The unselected view preserves the signed website wheel. A selected node
  // keeps its signed coordinates while changing only its highlighted graph.
  const isDirectlySelectedEdge = (source: string, target: string) =>
    Boolean(
      localMode &&
      selected &&
      (source === selected.slug || target === selected.slug),
    ) ||
    Boolean(
      !localMode &&
      selected?.origin === "core" &&
      (source === selected.slug || target === selected.slug),
    );
  const families = displayModel.families;
  const contextSlugs = new Set(displayModel.contextSlugs ?? []);
  const directSlugs = new Set(displayModel.directSlugs ?? []);
  const siblingSlugs = new Set(
    (displayModel.siblingPairs ?? []).flatMap((pair) =>
      pair.split("|").filter((slug) => slug !== displayModel.focusSlug),
    ),
  );
  const localNeighborSlugs = new Set([...directSlugs, ...siblingSlugs]);
  const embedded = layout === "embedded";

  return (
    <TooltipProvider>
      <figure
        className="m-0 min-w-0"
        aria-label={
          localMode && selected
            ? `Genre relationship wheel for ${selected.name}: ${directSlugs.size} direct relationships and ${siblingSlugs.size} derived siblings`
            : `Genre taxonomy wheel: ${displayModel.nodes.length} core genres in ${families} families`
        }
        data-layout={embedded ? "embedded" : "global"}
      >
        {error ? (
          <div className="mb-4">
            <OpsRefreshNotice
              message="Could not refresh the core taxonomy. Showing the last successful map."
              onRetry={refetch}
            />
          </div>
        ) : null}
        <header className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <p className="m-0">
            <strong className="font-semibold text-accent-action-hi">
              Taxonomy
            </strong>{" "}
            {data?.core_taxonomy?.taxonomy_id} {data?.core_taxonomy?.version} ·{" "}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">ed25519</span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {data?.core_taxonomy?.signature_valid
                  ? "Signature verified"
                  : "Signature check degraded"}
              </TooltipContent>
            </Tooltip>
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="m-0 cursor-help">
                {data?.core_taxonomy?.digest?.slice(0, 19) ??
                  "release metadata unavailable"}
                …
              </p>
            </TooltipTrigger>
            {data?.core_taxonomy?.digest ? (
              <TooltipContent side="top">
                {data.core_taxonomy.digest}
              </TooltipContent>
            ) : null}
          </Tooltip>
        </header>

        {selectedTaxonomyNode && selectedTaxonomyNode.origin !== "core" ? (
          <p
            className="mb-0 mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
            role="status"
          >
            {overlayCoreTargets.length
              ? `Core connections for ${selectedTaxonomyNode.name}`
              : `${selectedTaxonomyNode.name} has no linked core genre yet`}
          </p>
        ) : null}
        {localMode && selected ? (
          <p
            className="mb-0 mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
            role="status"
          >
            Selected relation map · {directSlugs.size} direct relationships ·{" "}
            {siblingSlugs.size} shared-parent siblings · full wheel context
          </p>
        ) : null}

        <div
          className="genre-wheel-layout mt-3"
          data-embedded={embedded ? "true" : undefined}
        >
          <div
            aria-label="Genre taxonomy wheel"
            className="genre-wheel-stage mx-auto min-w-0 w-full max-w-[760px]"
          >
            <svg
              className="genre-wheel-svg"
              data-local={localMode ? "true" : undefined}
              viewBox="0 0 760 760"
              role="group"
              aria-label={
                embedded
                  ? "Core genre families and their relationships. Select a genre to highlight its connections."
                  : "Core genre families and EQ inheritance. Activate a genre to inspect its EQ and catalog data."
              }
            >
              <circle
                cx={CENTER}
                cy={CENTER}
                r="132"
                fill="none"
                stroke="var(--color-border)"
                strokeOpacity="0.45"
              />
              <circle
                cx={CENTER}
                cy={CENTER}
                r="212"
                fill="none"
                stroke="var(--color-border)"
                strokeOpacity="0.45"
              />
              <defs>
                {[
                  [markerIds.parent, "var(--accent-action-hi)"],
                  [markerIds.influence, RELATION_STYLES.influence.color],
                  [markerIds.fusion, RELATION_STYLES.fusion.color],
                ].map(([id, color]) => (
                  <marker
                    key={id}
                    id={id}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path
                      d="M1 1 L8 5 L1 9"
                      fill="none"
                      stroke={color}
                      strokeWidth="1.4"
                    />
                  </marker>
                ))}
              </defs>
              <g aria-hidden="true">
                {displayModel.relatedPairs.map((pair) => {
                  const [source, target] = pair.split("|");
                  const active = isDirectlySelectedEdge(source!, target!);
                  return (
                    <path
                      key={pair}
                      data-pair={pair}
                      data-active={active ? "true" : undefined}
                      d={relatedPath(pair, displayModel.positions)}
                      fill="none"
                      stroke={
                        active
                          ? "var(--accent-action-hi)"
                          : "rgba(241, 245, 249, 0.06)"
                      }
                      strokeOpacity={active ? 0.72 : 1}
                      strokeWidth={active ? 1.6 : 1}
                      strokeDasharray="1.5 4"
                      strokeLinecap="round"
                      className="transition-[stroke,stroke-width] duration-300 motion-reduce:transition-none"
                    />
                  );
                })}
              </g>
              <g aria-hidden="true">
                {displayModel.parentEdges.map(({ slug, parent }) => {
                  const active = isDirectlySelectedEdge(slug, parent);
                  return (
                    <path
                      key={`${parent}:${slug}`}
                      data-edge={`${parent}:${slug}`}
                      data-active={active ? "true" : undefined}
                      d={parentPath(slug, parent, displayModel.positions)}
                      fill="none"
                      stroke={
                        active
                          ? "var(--accent-action-hi)"
                          : "rgba(241, 245, 249, 0.18)"
                      }
                      strokeOpacity={1}
                      strokeWidth={active ? 2.25 : 1}
                      markerEnd={
                        active ? `url(#${markerIds.parent})` : undefined
                      }
                      className="transition-[stroke,stroke-width] duration-300 motion-reduce:transition-none"
                    />
                  );
                })}
              </g>
              <g aria-hidden="true">
                {displayModel.semanticEdges.map((edge) => {
                  const active = isDirectlySelectedEdge(
                    edge.source,
                    edge.target,
                  );
                  const style = RELATION_STYLES[edge.type];
                  return (
                    <path
                      key={`${edge.source}:${edge.target}:${edge.type}`}
                      data-relation={edge.type}
                      data-edge={`${edge.source}:${edge.target}`}
                      data-active={active ? "true" : undefined}
                      d={relatedPath(
                        `${edge.source}|${edge.target}`,
                        displayModel.positions,
                      )}
                      fill="none"
                      stroke={style.color}
                      strokeOpacity={active ? 0.82 : 0.12}
                      strokeWidth={active ? 1.8 : 0.8}
                      strokeDasharray={style.dash}
                      markerEnd={
                        active ? `url(#${markerIds[edge.type]})` : undefined
                      }
                      className="transition-[stroke,stroke-width,stroke-opacity] duration-300 motion-reduce:transition-none"
                    />
                  );
                })}
              </g>
              {displayModel.siblingPairs?.length ? (
                <g aria-hidden="true">
                  {displayModel.siblingPairs.map((pair) => (
                    <path
                      key={`sibling:${pair}`}
                      data-relation="sibling-derived"
                      data-pair={pair}
                      data-active="true"
                      d={relatedPath(pair, displayModel.positions)}
                      fill="none"
                      stroke="var(--accent-action-hi)"
                      strokeOpacity="0.34"
                      strokeWidth="1"
                      strokeDasharray="4 5"
                    />
                  ))}
                </g>
              ) : null}
              <g>
                {displayModel.nodes.map((node) => {
                  const position = displayModel.positions.get(node.slug);
                  if (!position) return null;
                  const isRoot = !localMode && position.ring === 1;
                  const isInPath = !embedded && path.includes(node.slug);
                  const isSource = sourceSlug === node.slug;
                  const isSelected = activeSlug === node.slug;
                  const isRelated = localMode
                    ? localNeighborSlugs.has(node.slug)
                    : highlightedSlugs.has(node.slug);
                  const isSibling = localMode && siblingSlugs.has(node.slug);
                  const isContext = contextSlugs.has(node.slug);
                  const isActiveNode =
                    isSelected ||
                    isSource ||
                    (embedded && directSlugs.has(node.slug));
                  const hasDirectEq = node.eq_preset_source === "direct";
                  const degrees = (position.angle * 180) / Math.PI - 90;
                  const labelX = (position.flip ? -1 : 1) * (isRoot ? -12 : 10);
                  const textAnchor = position.flip === isRoot ? "start" : "end";
                  const fill = isActiveNode
                    ? "var(--accent-action)"
                    : hasDirectEq
                      ? "var(--color-foreground)"
                      : "var(--color-background)";
                  const nodeFill =
                    isSibling && !isActiveNode
                      ? "var(--accent-action-hi)"
                      : fill;
                  const stroke =
                    isActiveNode || isInPath
                      ? "var(--accent-action-hi)"
                      : isSibling
                        ? "var(--accent-action-hi)"
                        : hasDirectEq
                          ? "none"
                          : "var(--color-foreground)";

                  return (
                    <Tooltip key={node.slug}>
                      <TooltipTrigger asChild>
                        <g
                          role="button"
                          tabIndex={0}
                          aria-label={`${node.name}, ${node.eq_preset_source === "direct" ? "direct EQ" : node.eq_preset_source === "inherited" ? `EQ inherited from ${label(node.eq_preset_inherited_from ?? "unknown")}` : "no EQ preset"}. Inspect EQ inheritance.`}
                          aria-pressed={isSelected}
                          data-genre={node.slug}
                          data-ring={position.ring}
                          data-selected={isSelected ? "true" : undefined}
                          data-active={isActiveNode ? "true" : undefined}
                          data-role={
                            localMode
                              ? isSelected
                                ? "focus"
                                : directSlugs.has(node.slug)
                                  ? "direct"
                                  : isSibling
                                    ? "sibling"
                                    : isContext
                                      ? "context"
                                      : undefined
                              : undefined
                          }
                          transform={`translate(${number(position.x)} ${number(position.y)})`}
                          opacity={
                            isContext && !isRelated && !isSelected
                              ? 0.25
                              : isSibling
                                ? 0.82
                                : 1
                          }
                          className="genre-wheel-node cursor-pointer outline-none"
                          onClick={() => choose(node.slug)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              choose(node.slug);
                            }
                          }}
                        >
                          <circle
                            r={
                              isSelected
                                ? 8
                                : embedded && directSlugs.has(node.slug)
                                  ? 5.5
                                  : isSibling
                                    ? 4.5
                                    : isRoot
                                      ? 5.5
                                      : 3.5
                            }
                            fill={nodeFill}
                            fillOpacity={
                              isActiveNode
                                ? 1
                                : isSibling
                                  ? 0.65
                                  : hasDirectEq
                                    ? 0.55
                                    : 1
                            }
                            stroke={stroke}
                            strokeWidth={
                              isSelected
                                ? 2.25
                                : isActiveNode || isInPath
                                  ? 1.75
                                  : 1.25
                            }
                            className="transition-[fill,stroke,r] duration-300 motion-reduce:transition-none"
                          />
                          <text
                            transform={`rotate(${number(position.flip ? degrees + 180 : degrees)})`}
                            x={labelX}
                            textAnchor={textAnchor}
                            dy="0.35em"
                            fill={
                              isSelected || isInPath || (embedded && isRelated)
                                ? "var(--color-foreground)"
                                : "var(--text-muted)"
                            }
                            fontFamily="var(--font-mono)"
                            fontSize={isRoot ? 11.5 : 10}
                            letterSpacing={isRoot ? "0.1em" : "0.04em"}
                            className={isRoot ? "uppercase" : undefined}
                          >
                            {label(node.slug)}
                          </text>
                        </g>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {node.name} · {node.eq_preset_source ?? "no EQ"}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </g>
              <text
                x={CENTER}
                y={CENTER + 4}
                textAnchor="middle"
                fill="var(--color-foreground)"
                fontFamily="var(--font-display)"
                fontSize="40"
                fontWeight="800"
                letterSpacing="-0.04em"
              >
                {model.nodes.length}
              </text>
              <text
                x={CENTER}
                y={CENTER + 24}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontFamily="var(--font-mono)"
                fontSize="10.5"
                letterSpacing="0.14em"
              >
                GENRES
              </text>
            </svg>
          </div>

          {!embedded ? (
            <section
              className="genre-wheel-panel"
              aria-label="EQ inheritance detail"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <strong className="font-semibold text-accent-action-hi">
                  Genre EQ
                </strong>{" "}
                {selected?.eq_preset_source === "direct"
                  ? "direct preset"
                  : sourceSlug
                    ? "inherited from the nearest preset"
                    : "select a genre to inspect its curve"}
              </div>
              {selected ? (
                <div aria-live="polite" className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="m-0 font-display text-xl font-bold text-foreground">
                      {selected.name}
                    </h3>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      {selected.artist_count} artists · {selected.album_count}{" "}
                      albums
                    </span>
                  </div>
                  <div className="font-mono text-xs tracking-wide text-muted-foreground">
                    {path.map(label).join(" → ") || label(selected.slug)}
                  </div>
                  <strong className="font-display text-[clamp(2.2rem,4vw,3.6rem)] font-extrabold leading-[0.95] tracking-[-0.045em] text-accent-action-hi">
                    {sourceSlug ? label(sourceSlug) : "No EQ"}
                  </strong>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {selected.eq_preset_source === "direct"
                      ? "its own preset"
                      : sourceSlug
                        ? `inherited from ${label(sourceSlug)}`
                        : "no effective EQ curve"}
                  </span>
                </div>
              ) : (
                <p className="m-0 text-sm text-text-muted" role="status">
                  Select a genre on the wheel or from the curve list to inspect
                  its catalog data and EQ.
                </p>
              )}

              {selected ? (
                <ol
                  className="grid list-none grid-cols-10 gap-1.5 p-0 text-center font-mono"
                  aria-label="Ten equalizer band gains"
                >
                  {EQ_BANDS.map((band, index) => {
                    const gain = selectedGains[index] ?? 0;
                    return (
                      <li key={band} className="grid min-w-0 gap-1.5">
                        <div
                          className="genre-wheel-eq-track"
                          aria-hidden="true"
                        >
                          <div className="absolute inset-x-0 top-1/2 h-px bg-border/70" />
                          <div
                            className="absolute left-1/4 right-1/4 top-1/2 h-1/2 origin-top rounded-sm bg-gradient-to-b from-accent-action to-accent-action/25 transition-transform duration-500 motion-reduce:transition-none"
                            style={{ transform: `scaleY(${gain / -12})` }}
                          />
                        </div>
                        <b className="text-[10px] font-normal tabular-nums text-foreground sm:text-[11px]">
                          {formatGenreWheelGain(gain)}
                        </b>
                        <span className="text-[8px] text-muted-foreground sm:text-[9px]">
                          {band}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Genres without their own EQ"
              >
                {walkSlugs.map((slug) => (
                  <button
                    key={slug}
                    type="button"
                    aria-pressed={slug === activeSlug}
                    onClick={() => choose(slug)}
                    className={`min-h-8 rounded-full border px-3 font-mono text-[11px] tracking-[0.04em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action ${
                      slug === activeSlug
                        ? "border-accent-action bg-accent-action text-background"
                        : "border-border text-muted-foreground hover:border-accent-action/40 hover:text-foreground"
                    }`}
                  >
                    {label(slug)}
                  </button>
                ))}
              </div>

              <dl className="genre-wheel-legend">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Families</dt>
                  <dd className="m-0 tabular-nums text-foreground">
                    {families}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Parent links</dt>
                  <dd className="m-0 tabular-nums text-foreground">
                    {displayModel.parentEdges.length}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Related links</dt>
                  <dd className="m-0 tabular-nums text-foreground">
                    {displayModel.relatedPairs.length}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Stored edge types</dt>
                  <dd className="m-0 tabular-nums text-foreground">4</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>
        <figcaption
          className="genre-wheel-relationship-key"
          aria-label="Genre wheel relationship legend"
        >
          <span className="genre-wheel-relationship-key__title">Wheel key</span>
          <span className="genre-wheel-relationship-key__item">
            <span
              className="genre-wheel-relationship-key__line genre-wheel-relationship-key__line--parent"
              aria-hidden="true"
            />
            Parent to subgenre
          </span>
          <span className="genre-wheel-relationship-key__item">
            <span
              className="genre-wheel-relationship-key__line genre-wheel-relationship-key__line--related"
              aria-hidden="true"
            />
            Related, symmetric
          </span>
          <span className="genre-wheel-relationship-key__item">
            <span
              className="genre-wheel-relationship-key__line genre-wheel-relationship-key__line--influence"
              aria-hidden="true"
            />
            Influencer to influenced genre
          </span>
          <span className="genre-wheel-relationship-key__item">
            <span
              className="genre-wheel-relationship-key__line genre-wheel-relationship-key__line--fusion"
              aria-hidden="true"
            />
            Component to fusion genre
          </span>
          {localMode ? (
            <>
              <span className="genre-wheel-relationship-key__item">
                <span
                  className="genre-wheel-relationship-key__line genre-wheel-relationship-key__line--sibling"
                  aria-hidden="true"
                />
                Shared parent, derived
              </span>
            </>
          ) : null}
          <span className="genre-wheel-relationship-key__note">
            Arrowheads show direction on selected directed links.
          </span>
        </figcaption>
      </figure>
    </TooltipProvider>
  );
}
