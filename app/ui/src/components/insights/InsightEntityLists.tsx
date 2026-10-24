import { Link } from "react-router";
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
        <HairlineRow key={album.entity_uid ?? album.id}>
          <Link
            className="group flex min-h-11 min-w-0 items-start gap-3 py-2 text-text-primary outline-offset-4 hover:text-accent-action-hi"
            to={albumPagePath({
              albumId: album.id,
              albumEntityUid: album.entity_uid,
              albumSlug: album.slug,
              albumName: album.title,
              artistSlug: album.artist_slug,
              artistName: album.artist,
            })}
          >
            <MediaCover
              className="size-12 shrink-0"
              src={
                album.has_cover
                  ? albumCoverApiUrl({ albumId: album.id }, { size: 96 })
                  : null
              }
              alt=""
              fallback={album.title.slice(0, 1)}
            />
            <div className="min-w-0 flex-1">
              <div className="wrap-anywhere font-display text-base">
                {album.title}
              </div>
              <MonoLabel as="div" className="mt-1 wrap-anywhere">
                {album.artist} · {album.year ?? "Year unknown"}
              </MonoLabel>
              <p className="mt-1 text-xs text-text-muted">
                {reason === "unheard"
                  ? "No plays recorded in the available history"
                  : reason === "rediscover"
                    ? `Last recorded ${album.last_day ?? "date unavailable"}`
                    : `${number(album.played_tracks)} / ${number(album.tracks)} tracks with listening · ${minutes(album.minutes)}`}
              </p>
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
            <HairlineRow key={artist.entity_uid ?? artist.id}>
              <Link
                to={artistPagePath({
                  artistId: artist.id,
                  artistEntityUid: artist.entity_uid,
                  artistSlug: artist.slug,
                  artistName: artist.name,
                })}
                className="group flex min-h-11 min-w-0 items-center gap-3 py-3 hover:text-accent-action-hi"
              >
                <MediaCover
                  className="size-11 shrink-0"
                  shape="circle"
                  src={
                    artist.has_photo
                      ? artistPhotoApiUrl({ artistId: artist.id }, { size: 96 })
                      : null
                  }
                  alt=""
                  fallback={artist.name.slice(0, 1)}
                />
                <div className="min-w-0 flex-1">
                  <div className="wrap-anywhere font-display">
                    {artist.name}
                  </div>
                  <MonoLabel as="div" className="mt-1 wrap-anywhere">
                    {minutes(artist.current_minutes)} · previous{" "}
                    {minutes(artist.previous_minutes)}
                  </MonoLabel>
                  {artist.previous_minutes === 0 ? (
                    <p className="mt-1 text-xs text-text-muted">
                      No activity in previous period
                    </p>
                  ) : null}
                </div>
                <MonoLabel as="span" tone="accent" className="shrink-0">
                  {artist.delta_minutes > 0 ? "+" : ""}
                  {minutes(artist.delta_minutes)}
                </MonoLabel>
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
    <div className="space-y-10">
      {data.period?.history_complete === true ? (
        <div className="grid min-w-0 gap-x-10 gap-y-8 lg:grid-cols-2">
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ tone: "accent", children: "Explore the unheard" }}
            meta={`${number(data.unheard.total)} albums`}
            description={`No registered plays since ${data.period?.history_start ?? "the unknown start of recorded history"}. This does not mean never heard.`}
          >
            {data.unheard.items.length ? (
              <InsightAlbumList albums={data.unheard.items} reason="unheard" />
            ) : (
              <p className="text-sm text-text-muted">No albums in this set.</p>
            )}
            <Link
              to="/discover"
              className="mt-3 inline-flex min-h-11 items-center text-sm text-accent-action-hi underline-offset-4 hover:underline"
            >
              Open Discovery
            </Link>
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
              <p className="text-sm text-text-muted">No albums in this set.</p>
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
              <section className="min-w-0" key={item.key}>
                <h3 className="font-display text-lg">
                  {item.key === "full"
                    ? "Current Full profiles missing"
                    : "Stored Bliss vectors missing"}
                </h3>
                <MonoLabel as="p" className="mt-2">
                  {number(item.tracks)} tracks · {minutes(item.minutes)}{" "}
                  registered
                </MonoLabel>
                {item.albums.length ? (
                  <div className="mt-4">
                    <InsightAlbumList albums={item.albums} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-text-muted">
                    No affected listened albums.
                  </p>
                )}
                <Link
                  className="mt-3 inline-flex min-h-11 items-center text-sm text-accent-action-hi underline-offset-4 hover:underline"
                  to="/analysis"
                >
                  Open Analysis
                </Link>
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
