import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { forceCollide } from "d3-force-3d";
import ForceGraph2D from "react-force-graph-2d";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import {
  artistActionApiPath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import {
  ArtistNetworkInspector,
  type NetworkArtistCard,
  type NetworkExpansion,
} from "./network/ArtistNetworkInspector";
import {
  filterNetwork,
  labelVisible,
  linkEndpoint,
  mergeNetwork,
  neighborsOf,
  nodeKey,
  nodeRadius,
  sameArtist,
  type NetworkData,
  type NetworkFilter,
  type NetworkNode,
} from "./network/network-model";
import "./network/artist-network.css";

interface ArtistNetworkGraphProps {
  centerArtist: string;
  centerArtistId?: number;
  centerArtistEntityUid?: string;
}

interface NetworkCenter {
  name: string;
  artistId?: number;
  artistEntityUid?: string;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
  { value: "shows", label: "With shows" },
] as const;

function artistNetworkApiPath(
  name: string,
  artistId?: number,
  artistEntityUid?: string,
  depth?: number,
) {
  const byEntity = artistActionApiPath(
    { artistId, artistEntityUid },
    "network",
  );
  if (byEntity) {
    const params = depth != null ? `?depth=${depth}` : "";
    return `${byEntity}${params}`;
  }
  const qs = new URLSearchParams({ name });
  if (depth != null) qs.set("depth", String(depth));
  return `/api/network/external-artist?${qs}`;
}

function nodePhoto(node: NetworkNode) {
  return node.artist_id != null
    ? artistPhotoApiUrl({
        artistId: node.artist_id,
        artistSlug: node.artist_slug,
        artistName: node.id,
      })
    : `/api/network/external-artist/photo?name=${encodeURIComponent(node.id)}`;
}

function nodeHref(node: NetworkNode) {
  return node.in_library && node.artist_id != null
    ? artistPagePath({
        artistId: node.artist_id,
        artistSlug: node.artist_slug,
        artistName: node.id,
      })
    : `/download?q=${encodeURIComponent(node.id)}`;
}

export function ArtistNetworkGraph({
  centerArtist,
  centerArtistId,
  centerArtistEntityUid,
}: ArtistNetworkGraphProps) {
  const graphId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(undefined);
  const fitPendingRef = useRef(true);
  const expandedRef = useRef<Set<string>>(new Set());
  const motionAllowed = useMotionAllowed();
  const [width, setWidth] = useState(0);
  const [height] = useState(() =>
    Math.min(560, Math.round(window.innerHeight * 0.55)),
  );
  const [center, setCenter] = useState<NetworkCenter>({
    name: centerArtist,
    artistId: centerArtistId,
    artistEntityUid: centerArtistEntityUid,
  });
  const [history, setHistory] = useState<NetworkCenter[]>([]);
  const [networkData, setNetworkData] = useState<NetworkData>({
    nodes: [],
    links: [],
  });
  const dataRef = useRef(networkData);
  dataRef.current = networkData;
  const centerRef = useRef(center.name);
  centerRef.current = center.name;
  const [artistsWithShows, setArtistsWithShows] = useState<Set<string>>(
    new Set(),
  );
  const [filter, setFilter] = useState<NetworkFilter>("all");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expansions, setExpansions] = useState<Map<string, NetworkExpansion>>(
    new Map(),
  );
  const [failedExpansion, setFailedExpansion] = useState<NetworkNode | null>(
    null,
  );
  const [palette] = useState(() => {
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) =>
      style.getPropertyValue(name).trim() || style.color || "transparent";
    return {
      accent: color("--accent-action"),
      accentHi: color("--accent-action-hi"),
      primary: color("--text-primary"),
      muted: color("--text-muted"),
      subtle: color("--text-subtle"),
      surface: color("--surface-object"),
      border: color("--color-border"),
      warning: color("--state-warning-text"),
      font: style.getPropertyValue("--font-mono").trim() || "monospace",
    };
  });

  useEffect(() => {
    setCenter((previous) =>
      previous.name === centerArtist &&
      previous.artistId === centerArtistId &&
      previous.artistEntityUid === centerArtistEntityUid
        ? previous
        : {
            name: centerArtist,
            artistId: centerArtistId,
            artistEntityUid: centerArtistEntityUid,
          },
    );
    setHistory([]);
  }, [centerArtist, centerArtistEntityUid, centerArtistId]);

  useEffect(() => {
    api<{ artists: string[] }>("/api/shows/artists-with-shows")
      .then((data) =>
        setArtistsWithShows(
          new Set(data.artists.map((artist) => nodeKey(artist))),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFailedExpansion(null);
    setExpansions(new Map());
    expandedRef.current = new Set([nodeKey(center.name)]);
    fitPendingRef.current = true;
    api<NetworkData>(
      artistNetworkApiPath(
        center.name,
        center.artistId,
        center.artistEntityUid,
      ),
    )
      .then((data) => {
        if (cancelled) return;
        setNetworkData(data);
        setSelectedId(center.name);
      })
      .catch(() => {
        if (!cancelled) setError("Artist network could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [center, attempt]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setWidth(stage.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.floor(entry.contentRect.width);
        if (next > 0) setWidth(next);
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loading]);

  const visibleData = useMemo(
    () =>
      filterNetwork(
        networkData,
        filter,
        artistsWithShows,
        [center.name, selectedId].filter((id): id is string => Boolean(id)),
      ),
    [networkData, filter, artistsWithShows, center.name, selectedId],
  );

  const graphReady = width > 0;
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-220).distanceMax(420);
    graph.d3Force("link")?.distance(90);
    graph.d3Force("center")?.strength(0.05);
    graph.d3Force(
      "collide",
      forceCollide(
        (node: { id?: string; in_library?: boolean; score?: number }) =>
          nodeRadius(
            {
              id: node.id ?? "",
              group: 0,
              in_library: Boolean(node.in_library),
              score: node.score ?? 0,
            },
            sameArtist(node.id ?? "", centerRef.current),
          ) + 6,
      ).iterations(2),
    );
    graph.d3ReheatSimulation();
  }, [visibleData.nodes.length, graphReady]);

  const nodesByKey = useMemo(
    () => new Map(networkData.nodes.map((node) => [nodeKey(node.id), node])),
    [networkData.nodes],
  );
  const selected = selectedId
    ? (nodesByKey.get(nodeKey(selectedId)) ?? null)
    : null;
  const connections = useMemo(
    () => (selected ? neighborsOf(networkData, selected.id) : []),
    [networkData, selected],
  );
  const focus = useMemo(
    () =>
      selected
        ? new Set([
            nodeKey(selected.id),
            ...connections.map(({ node }) => nodeKey(node.id)),
          ])
        : new Set<string>(),
    [selected, connections],
  );
  const similarity = selected
    ? (neighborsOf(networkData, center.name).find(({ node }) =>
        sameArtist(node.id, selected.id),
      )?.score ?? null)
    : null;
  const card = useApi<NetworkArtistCard>(
    selected
      ? `/api/network/artist-card?name=${encodeURIComponent(selected.id)}`
      : null,
  );

  function expandNode(node: NetworkNode) {
    const key = nodeKey(node.id);
    if (expandedRef.current.has(key) || expansions.get(key) === "loading")
      return;
    setError(null);
    setFailedExpansion(null);
    setExpansions((previous) => new Map(previous).set(key, "loading"));
    api<NetworkData>(
      artistNetworkApiPath(node.id, node.artist_id, undefined, 1),
    )
      .then((data) => {
        expandedRef.current.add(key);
        const previous = dataRef.current;
        const result = mergeNetwork(previous, data);
        const parent = previous.nodes.find((item) =>
          sameArtist(item.id, node.id),
        ) as (NetworkNode & { x?: number; y?: number }) | undefined;
        for (const added of result.data.nodes.slice(previous.nodes.length)) {
          Object.assign(added, {
            x: (parent?.x ?? 0) + (Math.random() - 0.5) * 24,
            y: (parent?.y ?? 0) + (Math.random() - 0.5) * 24,
          });
        }
        setNetworkData(result.data);
        setExpansions((previous) =>
          new Map(previous).set(key, { added: result.added }),
        );
      })
      .catch(() => {
        setError(`Could not expand ${node.id}. Try again.`);
        setFailedExpansion(node);
        setExpansions((previous) => {
          const next = new Map(previous);
          next.delete(key);
          return next;
        });
      });
  }

  function recenter(node: NetworkNode) {
    setHistory((previous) => [...previous, center]);
    setCenter({ name: node.id, artistId: node.artist_id });
  }

  function goBack() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setCenter(previous);
  }

  if (loading) {
    return (
      <div
        style={{ height }}
        className="flex w-full items-center justify-center text-sm text-text-muted"
      >
        Loading network...
      </div>
    );
  }

  if (error && networkData.nodes.length <= 1)
    return (
      <ErrorState
        message={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );

  if (networkData.nodes.length <= 1) {
    return (
      <div
        style={{ height }}
        className="flex w-full items-center justify-center text-sm text-text-muted"
      >
        No similarity data available — run backfill-similarities task to
        populate.
      </div>
    );
  }

  const inLibraryCount = networkData.nodes.filter(
    (node) => node.in_library,
  ).length;
  const showsCount = networkData.nodes.filter((node) =>
    artistsWithShows.has(nodeKey(node.id)),
  ).length;
  const selectedIndex = visibleData.nodes.findIndex(
    (node) => selected != null && sameArtist(node.id, selected.id),
  );
  const expansion: NetworkExpansion = selected
    ? (expansions.get(nodeKey(selected.id)) ?? "idle")
    : "idle";
  const previousCenter = history[history.length - 1];

  return (
    <figure
      className="artist-network"
      aria-label={`Similarity network around ${center.name}: ${networkData.nodes.length} artists, ${inLibraryCount} in your library`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <MonoLabel
          accent="Similarity"
          meta={[
            sameArtist(center.name, centerArtist)
              ? null
              : `around ${center.name}`,
            `${networkData.nodes.length} artists`,
            `${inLibraryCount} in library`,
            `${networkData.nodes.length - inLibraryCount} missing`,
            showsCount ? `${showsCount} with shows` : null,
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          {previousCenter ? (
            <Button variant="ghost" size="sm" onClick={goBack}>
              Back to {previousCenter.name}
            </Button>
          ) : null}
          <SegmentedControl
            as="radio"
            label="Show artists"
            items={FILTERS}
            value={filter}
            onValueChange={setFilter}
          />
        </div>
      </header>

      {error ? (
        <div className="mt-3">
          <ErrorState
            message={error}
            onRetry={() =>
              failedExpansion
                ? expandNode(failedExpansion)
                : setAttempt((value) => value + 1)
            }
          />
        </div>
      ) : null}

      <div className="artist-network-layout">
        <div
          ref={stageRef}
          style={{ height }}
          role="listbox"
          aria-label="Artist network"
          aria-describedby={`${graphId}-instructions`}
          aria-activedescendant={
            selectedIndex >= 0 ? `${graphId}-node-${selectedIndex}` : undefined
          }
          tabIndex={0}
          className="artist-network-stage overflow-hidden"
          onKeyDown={(event) => {
            const count = visibleData.nodes.length;
            if (!count) return;
            let nextIndex = selectedIndex;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              nextIndex = (selectedIndex + 1) % count;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              nextIndex =
                selectedIndex < 0
                  ? count - 1
                  : (selectedIndex - 1 + count) % count;
            } else if (event.key === "Home") {
              nextIndex = 0;
            } else if (event.key === "End") {
              nextIndex = count - 1;
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (selected) expandNode(selected);
              return;
            } else {
              return;
            }
            event.preventDefault();
            const node = visibleData.nodes[nextIndex];
            if (node) setSelectedId(node.id);
          }}
        >
          <p id={`${graphId}-instructions`} className="sr-only">
            Use arrow keys to select an artist. Press Enter or Space to expand
            its relations. The selected artist card lists its connections and
            actions.
          </p>
          <div className="sr-only">
            {visibleData.nodes.map((node, index) => (
              <div
                key={node.id}
                id={`${graphId}-node-${index}`}
                role="option"
                aria-selected={
                  selected != null && sameArtist(node.id, selected.id)
                }
              >
                {node.id}
              </div>
            ))}
          </div>
          {width > 0 ? (
            <ForceGraph2D
              ref={fgRef}
              width={width}
              height={height}
              graphData={visibleData}
              backgroundColor="transparent"
              nodeRelSize={6}
              nodeLabel={() => ""}
              nodeVal={(node: any) => {
                const score =
                  nodesByKey.get(nodeKey(node.id ?? ""))?.score ?? 0;
                return sameArtist(node.id ?? "", center.name)
                  ? Math.max(4, score * 20)
                  : Math.max(1.5, score * 10);
              }}
              nodeCanvasObject={(
                node: any,
                ctx: CanvasRenderingContext2D,
                globalScale: number,
              ) => {
                const key = nodeKey(node.id ?? "");
                const current = nodesByKey.get(key);
                if (!current) return;
                const isCenter = sameArtist(current.id, center.name);
                const isSelected =
                  selected != null && sameArtist(current.id, selected.id);
                const inLibrary = current.in_library;
                const isHovered =
                  hoveredId != null && sameArtist(current.id, hoveredId);
                const dimmed =
                  selected != null && !focus.has(key) && !isHovered;
                const size = nodeRadius(current, isCenter);
                const x = node.x ?? 0;
                const y = node.y ?? 0;
                const alpha = dimmed ? 0.38 : 1;

                if (isCenter || isSelected) {
                  ctx.beginPath();
                  ctx.arc(x, y, size + 6, 0, 2 * Math.PI);
                  ctx.fillStyle = palette.accent;
                  ctx.globalAlpha = alpha * 0.14;
                  ctx.fill();
                }
                ctx.globalAlpha = alpha;

                if (artistsWithShows.has(key)) {
                  ctx.beginPath();
                  ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
                  ctx.strokeStyle = palette.warning;
                  ctx.lineWidth = 1.5;
                  ctx.setLineDash([3, 3]);
                  ctx.stroke();
                  ctx.setLineDash([]);
                }

                if (!isCenter && expandedRef.current.has(key)) {
                  ctx.beginPath();
                  ctx.arc(x, y, size + 2.5, 0, 2 * Math.PI);
                  ctx.strokeStyle = palette.accentHi;
                  ctx.lineWidth = 1;
                  ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(x, y, size, 0, 2 * Math.PI);
                ctx.fillStyle =
                  isCenter || isSelected || inLibrary
                    ? palette.accent
                    : palette.surface;
                ctx.fill();
                ctx.strokeStyle =
                  isCenter || isSelected || isHovered
                    ? palette.accentHi
                    : inLibrary
                      ? palette.accent
                      : palette.subtle;
                ctx.lineWidth =
                  isCenter || isSelected
                    ? 2.5
                    : isHovered
                      ? 2
                      : inLibrary
                        ? 1.5
                        : 1;
                ctx.stroke();

                if (
                  labelVisible({
                    node: current,
                    center: center.name,
                    selected: selected?.id ?? null,
                    hovered: hoveredId,
                    focus,
                    scale: globalScale,
                  })
                ) {
                  const fontSize = Math.max(10, 12 / globalScale);
                  ctx.font = `400 ${fontSize}px ${palette.font}`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";
                  ctx.fillStyle =
                    isCenter || isSelected || isHovered
                      ? palette.primary
                      : inLibrary
                        ? palette.muted
                        : palette.subtle;
                  ctx.fillText(current.id, x, y + size + 4);
                }
                ctx.globalAlpha = 1;
              }}
              linkColor={(link: any) =>
                selected != null &&
                (sameArtist(linkEndpoint(link.source), selected.id) ||
                  sameArtist(linkEndpoint(link.target), selected.id))
                  ? palette.accentHi
                  : palette.border
              }
              linkWidth={(link: any) => {
                const touches =
                  selected != null &&
                  (sameArtist(linkEndpoint(link.source), selected.id) ||
                    sameArtist(linkEndpoint(link.target), selected.id));
                const value = typeof link.value === "number" ? link.value : 0.5;
                return touches ? 1.5 : Math.max(0.5, value * 1.2);
              }}
              onNodeHover={(node: any) => {
                setHoveredId(node?.id ?? null);
                if (stageRef.current)
                  stageRef.current.style.cursor = node ? "pointer" : "default";
              }}
              onNodeClick={(node: any) => setSelectedId(node.id)}
              onBackgroundClick={() => setSelectedId(null)}
              cooldownTicks={motionAllowed ? 200 : 0}
              d3AlphaDecay={0.01}
              d3VelocityDecay={0.2}
              warmupTicks={motionAllowed ? 50 : 200}
              enableZoomInteraction={true}
              enablePanInteraction={true}
              enableNodeDrag={true}
              onEngineStop={() => {
                if (!fitPendingRef.current) return;
                fitPendingRef.current = false;
                fgRef.current?.zoomToFit(motionAllowed ? 400 : 0, 60);
              }}
            />
          ) : null}
        </div>

        <ArtistNetworkInspector
          node={selected}
          center={center.name}
          similarity={similarity}
          photoUrl={selected ? nodePhoto(selected) : undefined}
          openHref={selected ? nodeHref(selected) : "#"}
          hasShows={
            selected != null && artistsWithShows.has(nodeKey(selected.id))
          }
          connections={connections}
          card={card.data && !card.error ? card.data : null}
          expansion={expansion}
          canExpand={
            selected != null &&
            !expandedRef.current.has(nodeKey(selected.id)) &&
            expansion !== "loading"
          }
          onExpand={() => {
            if (selected) expandNode(selected);
          }}
          onCenter={() => {
            if (selected) recenter(selected);
          }}
          onSelect={(node) => setSelectedId(node.id)}
        />
      </div>

      <figcaption className="artist-network-key" aria-label="Network key">
        <span className="artist-network-key__item">
          <span
            className="artist-network-key__mark artist-network-key__mark--library"
            aria-hidden="true"
          />
          In library
        </span>
        <span className="artist-network-key__item">
          <span
            className="artist-network-key__mark artist-network-key__mark--missing"
            aria-hidden="true"
          />
          Not in library
        </span>
        <span className="artist-network-key__item">
          <span
            className="artist-network-key__mark artist-network-key__mark--shows"
            aria-hidden="true"
          />
          Upcoming shows
        </span>
        <span className="artist-network-key__item">
          <span
            className="artist-network-key__mark artist-network-key__mark--expanded"
            aria-hidden="true"
          />
          Expanded
        </span>
        <span className="artist-network-key__item">
          <span className="artist-network-key__line" aria-hidden="true" />
          Selected artist relations
        </span>
      </figcaption>
    </figure>
  );
}
