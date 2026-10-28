import { Link } from "react-router";
import { EntityAvatar } from "@crate/ui/domain/entity";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";

import { NextShowBadge, type NextShow } from "@/components/shows/NextShowBadge";
import { artistPagePath } from "@/lib/library-routes";

import {
  sameArtist,
  similarityPercent,
  type NetworkNeighbor,
  type NetworkNode,
} from "./network-model";

export interface NetworkArtistCard {
  name: string;
  in_library: boolean;
  artist_id?: number | null;
  artist_slug?: string | null;
  album_count?: number | null;
  track_count?: number | null;
  listeners?: number | null;
  genres: string[];
  linked_by: {
    name: string;
    score: number;
    artist_id?: number | null;
    artist_slug?: string | null;
  }[];
  next_show?: NextShow | null;
}

export type NetworkExpansion = "idle" | "loading" | { added: number };

const CONNECTION_LIMIT = 8;
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function ArtistNetworkInspector({
  node,
  center,
  similarity,
  photoUrl,
  openHref,
  hasShows,
  connections,
  card,
  expansion,
  canExpand,
  onExpand,
  onCenter,
  onSelect,
}: {
  node: NetworkNode | null;
  center: string;
  similarity: number | null;
  photoUrl?: string;
  openHref: string;
  hasShows: boolean;
  connections: NetworkNeighbor[];
  card: NetworkArtistCard | null;
  expansion: NetworkExpansion;
  canExpand: boolean;
  onExpand: () => void;
  onCenter: () => void;
  onSelect: (node: NetworkNode) => void;
}) {
  if (!node) {
    return (
      <section
        className="artist-network-inspector"
        aria-label="Selected artist"
      >
        <MonoLabel accent="Artist" meta={["nothing selected"]} />
        <p className="m-0 text-sm text-text-muted" role="status">
          Select an artist in the network to see its card, connections and
          actions.
        </p>
      </section>
    );
  }

  const isCenter = sameArtist(node.id, center);
  const inLibrary = card?.in_library ?? node.in_library;
  const linkedBy = (card?.linked_by ?? []).filter(
    (item) => !sameArtist(item.name, node.id),
  );

  return (
    <section
      className="artist-network-inspector"
      aria-label={`Selected artist ${node.id}`}
    >
      <MonoLabel
        accent="Artist"
        meta={[
          isCenter ? "network center" : null,
          !isCenter && similarity != null
            ? `${similarityPercent(similarity)} similar to ${center}`
            : null,
        ]}
      />

      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar
          src={photoUrl}
          name={node.id}
          alt=""
          size="lg"
          shape="rounded"
        />
        <div className="grid min-w-0 gap-1.5">
          <h3 className="m-0 font-display text-xl font-bold text-text-primary wrap-anywhere">
            {node.id}
          </h3>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot
              tone={inLibrary ? "on" : "off"}
              label={inLibrary ? "In library" : "Not in library"}
            />
            {hasShows ? <StatusDot tone="warn" label="Upcoming shows" /> : null}
          </span>
        </div>
      </div>

      {card && inLibrary ? (
        <dl className="artist-network-metrics">
          <StatNumber
            as="div"
            size="sm"
            value={card.album_count ?? "—"}
            label="Albums"
          />
          <StatNumber
            as="div"
            size="sm"
            value={card.track_count ?? "—"}
            label="Tracks"
          />
          <StatNumber
            as="div"
            size="sm"
            value={
              card.listeners != null ? compact.format(card.listeners) : "—"
            }
            label="Listeners"
          />
        </dl>
      ) : null}

      {card?.genres.length ? (
        <GenrePillRow items={card.genres.map((name) => ({ name }))} max={4} />
      ) : null}

      {card?.next_show ? <NextShowBadge show={card.next_show} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={openHref}>
            {inLibrary ? "Open artist" : "Search to acquire"}
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          loading={expansion === "loading"}
          disabled={!canExpand}
          onClick={onExpand}
        >
          Expand relations
        </Button>
        {!isCenter ? (
          <Button variant="ghost" size="sm" onClick={onCenter}>
            Center here
          </Button>
        ) : null}
      </div>
      {typeof expansion === "object" ? (
        <MonoLabel as="p" role="status">
          {expansion.added
            ? `+${expansion.added} artists added`
            : "No new relations known"}
        </MonoLabel>
      ) : null}

      {connections.length ? (
        <div className="grid gap-2">
          <MonoLabel as="p">{`Connections in graph · ${connections.length}`}</MonoLabel>
          <HairlineList label={`Connections of ${node.id}`} ruled={false}>
            {connections
              .slice(0, CONNECTION_LIMIT)
              .map(({ node: other, score }) => (
                <HairlineRow
                  key={other.id}
                  asChild
                  muted={!other.in_library}
                  trailing={
                    <span className="grid grid-cols-[3rem_5ch] items-center gap-2">
                      <ProgressHairline
                        label={`${other.id} similarity`}
                        value={score}
                      />
                      <MonoLabel as="span" className="text-right">
                        {similarityPercent(score)}
                      </MonoLabel>
                    </span>
                  }
                >
                  <button type="button" onClick={() => onSelect(other)}>
                    {other.id}
                  </button>
                </HairlineRow>
              ))}
          </HairlineList>
        </div>
      ) : null}

      {!inLibrary && linkedBy.length ? (
        <div className="grid gap-2">
          <MonoLabel as="p">{`Listed as similar by · ${linkedBy.length}`}</MonoLabel>
          <HairlineList
            label={`Library artists listing ${node.id}`}
            ruled={false}
          >
            {linkedBy.map((item) => (
              <HairlineRow
                key={item.name}
                asChild={item.artist_id != null}
                trailing={
                  <MonoLabel as="span">
                    {similarityPercent(item.score)}
                  </MonoLabel>
                }
              >
                {item.artist_id != null ? (
                  <Link
                    to={artistPagePath({
                      artistId: item.artist_id,
                      artistSlug: item.artist_slug ?? undefined,
                      artistName: item.name,
                    })}
                  >
                    {item.name}
                  </Link>
                ) : (
                  <span>{item.name}</span>
                )}
              </HairlineRow>
            ))}
          </HairlineList>
        </div>
      ) : null}
    </section>
  );
}
