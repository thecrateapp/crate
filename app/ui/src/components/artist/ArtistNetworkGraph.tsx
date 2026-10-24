import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { ArrowRight, Plus } from "@crate/ui/icons";
import ForceGraph2D from "react-force-graph-2d";

import { api } from "@/lib/api";
import {
  artistActionApiPath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface NetworkNode {
  id: string;
  group: number;
  in_library: boolean;
  score: number;
  artist_id?: number;
  artist_slug?: string;
}

interface NetworkLink {
  source: string;
  target: string;
  value: number;
}

interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

interface ArtistNetworkGraphProps {
  centerArtist: string;
  centerArtistId?: number;
  centerArtistEntityUid?: string;
}

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

export function ArtistNetworkGraph({
  centerArtist,
  centerArtistId,
  centerArtistEntityUid,
}: ArtistNetworkGraphProps) {
  const graphId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(undefined);
  const navigate = useNavigate();
  const [width, setWidth] = useState(0);
  const [height] = useState(() =>
    Math.min(600, Math.round(window.innerHeight * 0.55)),
  );
  const [networkData, setNetworkData] = useState<NetworkData>({
    nodes: [],
    links: [],
  });
  const expandedNodesRef = useRef<Set<string>>(new Set());
  const [artistsWithShows, setArtistsWithShows] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [expandingNode, setExpandingNode] = useState<string | null>(null);
  const [failedExpansion, setFailedExpansion] = useState<NetworkNode | null>(
    null,
  );
  const motionAllowed = useMotionAllowed();
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
    api<{ artists: string[] }>("/api/shows/artists-with-shows")
      .then((data) =>
        setArtistsWithShows(
          new Set(data.artists.map((artist) => artist.toLowerCase())),
        ),
      )
      .catch(() => {});

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    expandedNodesRef.current = new Set([centerArtist]);
    api<NetworkData>(
      artistNetworkApiPath(centerArtist, centerArtistId, centerArtistEntityUid),
    )
      .then((data) => {
        if (!cancelled) setNetworkData(data);
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
  }, [centerArtist, centerArtistEntityUid, centerArtistId, attempt]);

  function expandNode(node: NetworkNode) {
    if (expandedNodesRef.current.has(node.id) || expandingNode) return;
    setExpandingNode(node.id);
    setError(null);
    setFailedExpansion(null);
    api<NetworkData>(
      artistNetworkApiPath(node.id, node.artist_id, undefined, 1),
    )
      .then((data) => {
        expandedNodesRef.current.add(node.id);
        setNetworkData((previous) => {
          // Case-insensitive dedup — artist names vary in casing across sources
          const existingIds = new Set(
            previous.nodes.map((n) => n.id.toLowerCase()),
          );
          const existingLinkKeys = new Set(
            previous.links.map((l) => {
              const s =
                typeof l.source === "string"
                  ? l.source
                  : ((l.source as any)?.id ?? "");
              const t =
                typeof l.target === "string"
                  ? l.target
                  : ((l.target as any)?.id ?? "");
              return `${s.toLowerCase()}||${t.toLowerCase()}`;
            }),
          );
          const newNodes = data.nodes.filter(
            (n) => !existingIds.has(n.id.toLowerCase()),
          );
          const newLinks = data.links.filter((l) => {
            const key = `${l.source.toLowerCase()}||${l.target.toLowerCase()}`;
            const rev = `${l.target.toLowerCase()}||${l.source.toLowerCase()}`;
            return !existingLinkKeys.has(key) && !existingLinkKeys.has(rev);
          });
          // Remap new links to use existing node IDs (preserve original casing)
          const idMap = new Map(
            previous.nodes.map((n) => [n.id.toLowerCase(), n.id]),
          );
          for (const n of newNodes) idMap.set(n.id.toLowerCase(), n.id);
          const remappedLinks = newLinks.map((l) => ({
            ...l,
            source: idMap.get(l.source.toLowerCase()) ?? l.source,
            target: idMap.get(l.target.toLowerCase()) ?? l.target,
          }));
          return {
            nodes: [...previous.nodes, ...newNodes],
            links: [...previous.links, ...remappedLinks],
          };
        });
      })
      .catch(() => {
        setError(`Could not expand ${node.id}. Try again.`);
        setFailedExpansion(node);
      })
      .finally(() => setExpandingNode(null));
  }

  const nodeHref = (node: NetworkNode) =>
    node.in_library && node.artist_id != null
      ? artistPagePath({
          artistId: node.artist_id,
          artistSlug: node.artist_slug,
          artistName: node.id,
        })
      : `/download?q=${encodeURIComponent(node.id)}`;

  useEffect(() => {
    if (!containerRef.current) return;
    requestAnimationFrame(() => {
      if (containerRef.current) setWidth(containerRef.current.clientWidth);
    });
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => {
      const tooltips = container.querySelectorAll<HTMLElement>(
        "div[style*='background: rgba']",
      );
      tooltips.forEach((element) => {
        element.style.background = "transparent";
        element.style.padding = "0";
        element.style.border = "none";
        element.style.borderRadius = "0";
        element.style.font = "inherit";
        element.style.color = "inherit";
      });
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-200).distanceMax(350);
    graph.d3Force("link")?.distance(100);
    graph.d3Force("center")?.strength(0.05);
    graph.d3ReheatSimulation();
  }, [networkData.nodes.length]);

  if (loading || width === 0) {
    return (
      <div
        ref={containerRef}
        style={{ height }}
        className="flex w-full items-center justify-center text-muted-foreground text-sm"
      >
        Loading network...
      </div>
    );
  }

  if (error && networkData.nodes.length <= 1)
    return (
      <div ref={containerRef}>
        <ErrorState
          message={error}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );

  if (networkData.nodes.length <= 1) {
    return (
      <div
        ref={containerRef}
        style={{ height }}
        className="flex w-full items-center justify-center text-muted-foreground text-sm"
      >
        No similarity data available — run backfill-similarities task to
        populate.
      </div>
    );
  }

  const nodeSet = new Map(
    networkData.nodes.map((node) => [node.id.toLowerCase(), node]),
  );
  const selectedIndex = networkData.nodes.findIndex(
    (node) => node.id === selectedNode?.id,
  );

  return (
    <div className="min-w-0 space-y-4">
      {error ? (
        <ErrorState
          message={error}
          onRetry={() =>
            failedExpansion
              ? expandNode(failedExpansion)
              : setAttempt((value) => value + 1)
          }
        />
      ) : null}
      {selectedNode ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <MonoLabel>{selectedNode.id}</MonoLabel>
          <ActionGroup label={`Actions for ${selectedNode.id}`}>
            <ActionButton
              asChild
              label={`Open selected artist ${selectedNode.id}`}
            >
              <Link to={nodeHref(selectedNode)}>
                <ArrowRight
                  data-admin-ux="artist-network-open"
                  aria-hidden="true"
                />
              </Link>
            </ActionButton>
            <ActionButton
              label={`Expand selected artist ${selectedNode.id}`}
              disabled={
                Boolean(expandingNode) ||
                expandedNodesRef.current.has(selectedNode.id)
              }
              loading={expandingNode === selectedNode.id}
              onClick={() => expandNode(selectedNode)}
            >
              <Plus
                data-admin-ux="artist-network-expand-selected"
                aria-hidden="true"
              />
            </ActionButton>
          </ActionGroup>
        </div>
      ) : null}
      <div
        ref={containerRef}
        style={{ height }}
        role="listbox"
        aria-label="Artist network"
        aria-describedby={`${graphId}-instructions`}
        aria-activedescendant={
          selectedIndex >= 0 ? `${graphId}-node-${selectedIndex}` : undefined
        }
        tabIndex={0}
        className="w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-focus-ring"
        onKeyDown={(event) => {
          let nextIndex = selectedIndex;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextIndex = (selectedIndex + 1) % networkData.nodes.length;
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            nextIndex =
              selectedIndex < 0
                ? networkData.nodes.length - 1
                : (selectedIndex - 1 + networkData.nodes.length) %
                  networkData.nodes.length;
          } else if (event.key === "Home") {
            nextIndex = 0;
          } else if (event.key === "End") {
            nextIndex = networkData.nodes.length - 1;
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const node = selectedNode ?? networkData.nodes[0];
            if (node) {
              setSelectedNode(node);
              expandNode(node);
            }
            return;
          } else {
            return;
          }
          event.preventDefault();
          const node = networkData.nodes[nextIndex];
          if (node) setSelectedNode(node);
        }}
      >
        <p id={`${graphId}-instructions`} className="sr-only">
          Use arrow keys to select an artist. Press Enter or Space to expand its
          neighbours. Use the selected artist actions to open its page.
        </p>
        <div className="sr-only">
          {networkData.nodes.map((node, index) => (
            <div
              key={node.id}
              id={`${graphId}-node-${index}`}
              role="option"
              aria-selected={selectedNode?.id === node.id}
            >
              {node.id}
            </div>
          ))}
        </div>
        <ForceGraph2D
          ref={fgRef}
          width={width}
          height={height}
          graphData={networkData}
          backgroundColor="transparent"
          nodeRelSize={6}
          nodeVal={(node: any) => {
            const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as
              NetworkNode | undefined;
            const score = currentNode?.score ?? 0;
            if (node.id?.toLowerCase() === centerArtist.toLowerCase())
              return Math.max(4, score * 20);
            return Math.max(1.5, score * 10);
          }}
          nodeCanvasObject={(
            node: any,
            ctx: CanvasRenderingContext2D,
            globalScale: number,
          ) => {
            const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as
              NetworkNode | undefined;
            const score = currentNode?.score ?? 0;
            const inLibrary = currentNode?.in_library ?? false;
            const hasShows = artistsWithShows.has(node.id.toLowerCase());
            const isCenter =
              node.id?.toLowerCase() === centerArtist.toLowerCase();
            const isSelected = selectedNode?.id === node.id;

            const baseSize = isCenter ? 14 : inLibrary ? 7 : 5;
            const scoreBonus = score * 8;
            const size = Math.max(baseSize, baseSize + scoreBonus);

            const x = node.x ?? 0;
            const y = node.y ?? 0;

            // Keep the current selection visible, including artists outside the library.
            if (isCenter || inLibrary || isSelected) {
              ctx.beginPath();
              ctx.arc(x, y, size + 6, 0, 2 * Math.PI);
              ctx.fillStyle = palette.accent;
              ctx.globalAlpha = isCenter || isSelected ? 0.12 : 0.06;
              ctx.fill();
              ctx.globalAlpha = 1;
            }

            // Shows ring
            if (hasShows) {
              ctx.beginPath();
              ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
              ctx.strokeStyle = palette.warning;
              ctx.lineWidth = 1.5;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Main circle
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            if (isCenter || isSelected) {
              ctx.fillStyle = palette.accent;
            } else if (inLibrary) {
              ctx.fillStyle = palette.accent;
            } else {
              ctx.fillStyle = palette.surface;
            }
            ctx.fill();

            // Border
            ctx.strokeStyle =
              isCenter || isSelected
                ? palette.accentHi
                : inLibrary
                  ? palette.accent
                  : palette.border;
            ctx.lineWidth =
              isCenter || isSelected ? 2.5 : inLibrary ? 1.5 : 0.5;
            ctx.stroke();

            // Label
            const fontSize = Math.max(10, 12 / globalScale);
            ctx.font = `400 ${fontSize}px ${palette.font}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle =
              isCenter || isSelected
                ? palette.primary
                : inLibrary
                  ? palette.muted
                  : palette.subtle;
            ctx.fillText(node.id, x, y + size + 4);

            // In-library satellite dot
            if (inLibrary && !isCenter) {
              ctx.beginPath();
              ctx.arc(x + size * 0.7, y - size * 0.7, 3, 0, 2 * Math.PI);
              ctx.fillStyle = palette.accentHi;
              ctx.fill();
              ctx.strokeStyle = palette.surface;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }}
          linkColor={(link: any) => {
            const sId = (
              typeof link.source === "string"
                ? link.source
                : (link.source?.id ?? "")
            ).toLowerCase();
            const tId = (
              typeof link.target === "string"
                ? link.target
                : (link.target?.id ?? "")
            ).toLowerCase();
            const sNode = nodeSet.get(sId);
            const tNode = nodeSet.get(tId);
            if (
              selectedNode?.id.toLowerCase() === sId ||
              selectedNode?.id.toLowerCase() === tId ||
              (sNode?.in_library && tNode?.in_library)
            )
              return palette.accent;
            return palette.border;
          }}
          linkWidth={(link: any) => {
            const v = typeof link.value === "number" ? link.value : 0.5;
            return Math.max(0.5, v * 2);
          }}
          nodeLabel={(node: any) => {
            const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as
              NetworkNode | undefined;
            const inLibrary = currentNode?.in_library ?? false;
            const score = currentNode?.score ?? 0;
            const photoUrl =
              currentNode?.artist_id != null
                ? artistPhotoApiUrl({
                    artistId: currentNode.artist_id,
                    artistSlug: currentNode.artist_slug,
                    artistName: node.id,
                  })
                : "";
            return `<div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:4px;padding:0;font-size:12px;min-width:200px;overflow:hidden">
            <div style="display:flex;align-items:center;gap:8px;padding:10px 12px">
              ${
                photoUrl
                  ? `<img src="${photoUrl}" class="crate-media-thumbnail" style="width:48px;height:48px;border-radius:6px;object-fit:cover;background:var(--surface-object)" onerror="this.style.display='none'" />`
                  : ""
              }
              <div style="min-width:0;flex:1">
                <div style="font-weight:600;color:var(--color-foreground)">${escapeHtml(
                  node.id,
                )}</div>
              </div>
            </div>
            ${
              score > 0
                ? `<div style="padding:0 12px 8px">
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:5px;background:var(--surface-object);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(
                    score * 100,
                  )}%;border-radius:3px;background:var(--accent-action)"></div>
                </div>
                <span style="font-size:9px;color:var(--color-muted-foreground)">${Math.round(
                  score * 100,
                )}%</span>
              </div>
            </div>`
                : ""
            }
            <div style="padding:6px 12px;border-top:1px solid var(--color-border);font-size:10px;display:flex;justify-content:space-between;align-items:center">
              <span style="color:${
                inLibrary ? palette.accent : "var(--color-muted-foreground)"
              }">${inLibrary ? "In library" : "Not in library"}</span>
              ${
                artistsWithShows.has(node.id.toLowerCase())
                  ? `<span style="color:var(--state-warning-text)">Shows</span>`
                  : ""
              }
              <span style="color:var(--color-primary)">Click to expand · Right-click to open</span>
            </div>
          </div>`;
          }}
          onNodeClick={(node: any) => {
            const selected = node as NetworkNode;
            setSelectedNode(selected);
            expandNode(selected);
          }}
          onNodeRightClick={(node: any) => {
            const currentNode = nodeSet.get((node.id ?? "").toLowerCase()) as
              NetworkNode | undefined;
            if (currentNode?.in_library && currentNode.artist_id != null) {
              navigate(
                artistPagePath({
                  artistId: currentNode.artist_id,
                  artistSlug: currentNode.artist_slug,
                  artistName: node.id,
                }),
              );
            } else {
              navigate(`/download?q=${encodeURIComponent(node.id)}`);
            }
          }}
          cooldownTicks={motionAllowed ? 200 : 0}
          d3AlphaDecay={0.01}
          d3VelocityDecay={0.2}
          warmupTicks={motionAllowed ? 50 : 200}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          enableNodeDrag={true}
          onEngineStop={() => {
            fgRef.current?.zoomToFit(motionAllowed ? 400 : 0, 60);
          }}
        />
      </div>
    </div>
  );
}
