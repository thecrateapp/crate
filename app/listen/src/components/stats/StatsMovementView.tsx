import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ReactNode } from "react";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Card } from "@crate/ui/shadcn/card";
import type { StatsStory, StatsStoryArtistSignal } from "./stats-types";

export type StatsMovementScope = "personal" | "user" | "global";

const COLUMN_LIMIT = 5;

/** Drops artists already featured above; trimmed, case-sensitive match. */
export function statsMovementVisible(
  signals: StatsStoryArtistSignal[],
  exclude: ReadonlySet<string>,
  keep: (artist: StatsStoryArtistSignal) => boolean = () => true,
) {
  return signals
    .filter((artist) => !exclude.has(artist.artist_name.trim()) && keep(artist))
    .slice(0, COLUMN_LIMIT);
}

/** Rising lists real gains only; flat, negative or missing deltas are noise. */
const isRealGain = (artist: StatsStoryArtistSignal) =>
  (artist.delta_play_count ?? 0) > 0;

/** The New column as shown: none on Crate Pulse, exclusions applied otherwise. */
export function statsMovementNewArtists(
  story: Pick<StatsStory, "discoveries">,
  exclude: readonly string[],
  scope: StatsMovementScope,
) {
  if (scope === "global") return [];
  return statsMovementVisible(
    story.discoveries,
    new Set(exclude.map((name) => name.trim())),
  );
}

export function StatsMovementView({
  story,
  exclude,
  scope,
  renderArtist,
  getArtistHref,
}: {
  story: Pick<StatsStory, "movers" | "discoveries" | "comebacks">;
  /** Artist of the period plus the top three artists, already shown above. */
  exclude: readonly string[];
  scope: StatsMovementScope;
  renderArtist: (artist: StatsStoryArtistSignal) => ReactNode;
  getArtistHref: (artist: StatsStoryArtistSignal) => string;
}) {
  const { t } = useTranslation();
  const skip = new Set(exclude.map((name) => name.trim()));
  const rising = statsMovementVisible(story.movers, skip, isRealGain);
  const columns = [
    <MovementColumn
      key="rising"
      title={t("stats.story.rising")}
      emptyTitle={t("stats.story.noSurge")}
      emptyBody={t("stats.story.risingFallback")}
      items={rising}
      body={(artist) =>
        `+${t("stats.explorer.plays", { count: artist.delta_play_count ?? 0 })}`
      }
      renderArtist={renderArtist}
      getArtistHref={getArtistHref}
    />,
  ];
  if (scope !== "global") {
    columns.push(
      <MovementColumn
        key="new"
        title={t("stats.story.newBlood")}
        emptyTitle={t("stats.story.noNewObsession")}
        emptyBody={t("stats.story.discoveryFallback")}
        items={statsMovementNewArtists(story, exclude, scope)}
        body={(artist) =>
          t("stats.explorer.plays", { count: artist.play_count })
        }
        renderArtist={renderArtist}
        getArtistHref={getArtistHref}
      />,
      <MovementColumn
        key="back"
        title={t("stats.story.comeback")}
        emptyTitle={t("stats.story.noComeback")}
        emptyBody={t("stats.story.comebackFallback")}
        items={statsMovementVisible(story.comebacks, skip)}
        body={(artist) =>
          t("stats.explorer.plays", { count: artist.play_count })
        }
        renderArtist={renderArtist}
        getArtistHref={getArtistHref}
      />,
    );
  }
  return (
    // The Listen header is fixed over a document-scrolling page: the
    // #movement jump from Highlights clears it with the shell's page-top
    // metric (header height plus the standard gap below it).
    <section
      id="movement"
      className="@container grid min-w-0 scroll-mt-(--listen-mobile-page-top) gap-4"
    >
      <SectionHeader title={t("stats.movement.title")} />
      <div
        className={
          scope === "global"
            ? "grid min-w-0 gap-5"
            : "grid min-w-0 gap-5 @3xl:grid-cols-3"
        }
      >
        {columns}
      </div>
    </section>
  );
}

function MovementColumn({
  title,
  emptyTitle,
  emptyBody,
  items,
  body,
  renderArtist,
  getArtistHref,
}: {
  title: string;
  emptyTitle: string;
  emptyBody: string;
  items: StatsStoryArtistSignal[];
  body: (artist: StatsStoryArtistSignal) => string;
  renderArtist: (artist: StatsStoryArtistSignal) => ReactNode;
  getArtistHref: (artist: StatsStoryArtistSignal) => string;
}) {
  return (
    <Card as="section" className="min-w-0 gap-4 p-5">
      <MonoLabel as="h3" tone="accent">
        {title}
      </MonoLabel>
      {items.length ? (
        <ul className="divide-y divide-border-quiet">
          {items.map((artist) => (
            <li key={artist.artist_name}>
              <Link
                to={getArtistHref(artist)}
                className="flex items-center gap-3 py-2.5"
              >
                {renderArtist(artist)}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {artist.artist_name}
                  </div>
                  <MonoLabel>{body(artist)}</MonoLabel>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-text-primary">
            {emptyTitle}
          </p>
          <p className="text-xs text-text-muted">{emptyBody}</p>
        </div>
      )}
    </Card>
  );
}
