import { Link } from "react-router";
import { Button } from "@crate/ui/shadcn/button";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import {
  minutes,
  number,
  type CollectionInsights,
  type InsightAlbum,
  type InsightArtistChange,
} from "./insights-model";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

export function InsightAlbumList({
  albums,
  reason,
}: {
  albums: InsightAlbum[];
  reason?: "unheard" | "rediscover";
}) {
  return (
    <HairlineList>
      {albums.map((album) => (
        <HairlineRow
          key={album.entity_uid ?? album.id}
          asChild
          truncate={false}
        >
          <Link
            className="group min-h-11 outline-offset-4"
            to={albumPagePath({
              albumId: album.id,
              albumEntityUid: album.entity_uid,
              albumSlug: album.slug,
              albumName: album.title,
              artistSlug: album.artist_slug,
              artistName: album.artist,
            })}
          >
            <div className="flex min-w-0 items-start gap-3 text-text-primary group-hover:text-accent-action-hi">
              <MediaCover
                size={48}
                src={
                  album.has_cover
                    ? albumCoverApiUrl({ albumId: album.id }, { size: 96 })
                    : null
                }
                alt=""
                fallback={album.title.slice(0, 1)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="wrap-anywhere font-display text-base">
                  {album.title}
                </div>
                <MonoLabel as="div" className="wrap-anywhere">
                  {album.artist} · {album.year ?? "Year unknown"}
                </MonoLabel>
                <p className="text-xs text-text-muted">
                  {reason === "unheard"
                    ? "No plays recorded in the available history"
                    : reason === "rediscover"
                      ? `Last recorded ${album.last_day ?? "date unavailable"}`
                      : `${number(album.played_tracks)} / ${number(
                          album.tracks,
                        )} tracks with listening · ${minutes(album.minutes)}`}
                </p>
              </div>
            </div>
          </Link>
        </HairlineRow>
      ))}
    </HairlineList>
  );
}

function ArtistChanges({
  label,
  artists,
  previousComplete,
}: {
  label: string;
  artists: InsightArtistChange[];
  previousComplete: boolean;
}) {
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      label={{ tone: "accent", children: label }}
    >
      {!previousComplete ? (
        <p className="text-sm text-text-muted">
          A complete previous period is needed to compare artists.
        </p>
      ) : artists.length === 0 ? (
        <p className="text-sm text-text-muted">
          Insufficient activity to show changes.
        </p>
      ) : (
        <HairlineList>
          {artists.map((artist) => (
            <HairlineRow
              key={artist.entity_uid ?? artist.id}
              asChild
              truncate={false}
            >
              <Link
                to={artistPagePath({
                  artistId: artist.id,
                  artistEntityUid: artist.entity_uid,
                  artistSlug: artist.slug,
                  artistName: artist.name,
                })}
                className="group min-h-11 outline-offset-4"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-3 text-text-primary group-hover:text-accent-action-hi">
                  <MediaCover
                    size={48}
                    shape="circle"
                    src={
                      artist.has_photo
                        ? artistPhotoApiUrl(
                            { artistId: artist.id },
                            { size: 96 },
                          )
                        : null
                    }
                    alt=""
                    fallback={artist.name.slice(0, 1)}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="wrap-anywhere font-display">
                      {artist.name}
                    </div>
                    <MonoLabel as="div" className="wrap-anywhere">
                      {minutes(artist.current_minutes)} · previous{" "}
                      {minutes(artist.previous_minutes)}
                    </MonoLabel>
                    {artist.previous_minutes === 0 ? (
                      <p className="text-xs text-text-muted">
                        No activity in previous period
                      </p>
                    ) : null}
                  </div>
                  <MonoLabel as="span" tone="accent" className="shrink-0">
                    {artist.delta_minutes > 0 ? "+" : ""}
                    {minutes(artist.delta_minutes)}
                  </MonoLabel>
                </div>
              </Link>
            </HairlineRow>
          ))}
        </HairlineList>
      )}
    </InstrumentPanel>
  );
}
export function InsightChanges({ data }: { data: CollectionInsights }) {
  return (
    <div className="grid min-w-0 gap-x-10 gap-y-8 lg:grid-cols-2">
      <ArtistChanges
        label="Rising listening"
        artists={data.rising}
        previousComplete={data.period?.previous_complete === true}
      />
      <ArtistChanges
        label="Falling listening"
        artists={data.falling}
        previousComplete={data.period?.previous_complete === true}
      />
    </div>
  );
}
export function InsightOpportunities({
  data,
  fullEnabled,
}: {
  data: CollectionInsights;
  fullEnabled: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-10">
      {data.period?.history_complete === true ? (
        <div className="grid min-w-0 gap-x-10 gap-y-8 lg:grid-cols-2">
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ tone: "accent", children: "Explore the unheard" }}
            meta={`${number(data.unheard.total)} albums`}
            description={`No registered plays since ${
              data.period?.history_start ??
              "the unknown start of recorded history"
            }. This does not mean never heard.`}
          >
            <div className="flex min-w-0 flex-col items-start gap-4">
              <div className="w-full min-w-0">
                {data.unheard.items.length ? (
                  <InsightAlbumList
                    albums={data.unheard.items}
                    reason="unheard"
                  />
                ) : (
                  <p className="text-sm text-text-muted">
                    No albums in this set.
                  </p>
                )}
              </div>
              <Button asChild variant="secondary">
                <Link to="/discover">Open Discovery</Link>
              </Button>
            </div>
          </InstrumentPanel>
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ tone: "accent", children: "Rediscover" }}
            meta={`${number(data.rediscover.total)} albums`}
            description="Previously heard albums with no registered events in the last 90 days."
          >
            {data.rediscover.items.length ? (
              <InsightAlbumList
                albums={data.rediscover.items}
                reason="rediscover"
              />
            ) : (
              <EmptyState title="No albums in this set" />
            )}
          </InstrumentPanel>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Listening history is still being reconciled; exploration lists are
          unavailable.
        </p>
      )}
      <InstrumentPanel
        as="section"
        headingLevel={2}
        label={{
          tone: "accent",
          children: "Improvements with listening impact",
        }}
        description="Priorities among listened tracks. Missing analysis does not demonstrate a playback fault; analysis actions remain in Analysis."
      >
        <div className="grid min-w-0 gap-x-10 gap-y-8 lg:grid-cols-2">
          {data.improvements
            .filter((item) => item.key !== "full" || fullEnabled)
            .map((item) => (
              <section
                className="flex min-w-0 flex-col items-start gap-4"
                key={item.key}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="font-display text-lg">
                    {item.key === "full"
                      ? "Current Full profiles missing"
                      : "Stored Bliss vectors missing"}
                  </h3>
                  <MonoLabel as="p">
                    {number(item.tracks)} tracks · {minutes(item.minutes)}{" "}
                    registered
                  </MonoLabel>
                </div>
                {item.albums.length ? (
                  <div className="w-full min-w-0">
                    <InsightAlbumList albums={item.albums} />
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    No affected listened albums.
                  </p>
                )}
                <Button asChild variant="secondary">
                  <Link to="/analysis">Open Analysis</Link>
                </Button>
              </section>
            ))}
        </div>
        {data.improvements.filter((item) => item.key !== "full" || fullEnabled)
          .length === 0 ? (
          <p className="text-sm text-text-muted">
            No analysis priorities available.
          </p>
        ) : null}
      </InstrumentPanel>
    </div>
  );
}
