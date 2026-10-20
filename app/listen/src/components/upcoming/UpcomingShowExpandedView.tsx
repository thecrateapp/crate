import type { ReactNode } from "react";
import { Link } from "react-router";
import "./show-ticket.css";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  CalendarPlus,
  CRATE_ICON_SIZE,
  ExternalLink,
  MapPin,
  Play,
  X,
} from "@crate/ui/icons";

import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";
import { FormField } from "@crate/ui/primitives/FormField";
import { cn } from "@crate/ui/lib/cn";

import {
  formatShowTimeRemaining,
  showDirectionsUrl,
} from "./UpcomingShowCardModel";
import type { ExpandedViewProps } from "./UpcomingShowCardViewTypes";

type Setlist = NonNullable<ExpandedViewProps["item"]["probable_setlist"]>;

function TicketHeader({
  item,
  artistHref,
  dateLabel,
  timeLabel,
  timeRemaining,
  attending,
  onClose,
  showClose,
  menuAction,
}: {
  item: ExpandedViewProps["item"];
  artistHref: string;
  dateLabel: string;
  timeLabel: string;
  timeRemaining: string | null;
  attending: boolean;
  onClose: () => void;
  showClose: boolean;
  menuAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const support = (item.lineup || []).slice(1);
  const addressLabel = [item.address_line1, item.postal_code]
    .filter(Boolean)
    .join(" ");
  const locationLabel = [item.city, item.region, item.country]
    .filter(Boolean)
    .join(", ");
  const genreItems = item.genre_profile?.length
    ? item.genre_profile
    : (item.genres || []).map((name) => ({ name }));

  return (
    <header className="relative px-5 pt-5 pb-6 sm:px-7 sm:pt-7">
      <div className="absolute top-2 right-2 z-10">
        <ActionGroup label={t("actions.menu.more")}>
          {menuAction}
          {showClose && (
            <ActionButton
              onClick={onClose}
              label={t("radar.show.closeDetails")}
            >
              <X size={CRATE_ICON_SIZE.md} />
            </ActionButton>
          )}
        </ActionGroup>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pr-24">
        <MonoLabel accent={timeRemaining} meta={[dateLabel, timeLabel]} />
        {attending ? <StatusDot label={t("radar.show.attending")} /> : null}
      </div>

      <Link
        to={artistHref}
        className="link-meta mt-4 block w-fit max-w-full font-display text-4xl font-extrabold leading-display tracking-display text-balance break-words text-text-primary sm:text-6xl"
      >
        {item.artist}
      </Link>
      {support.length > 0 && (
        <p className="mt-3 truncate text-sm text-text-muted">
          {t("radar.show.withSupportPrefix")} {support.slice(0, 4).join(" · ")}
          {support.length > 4 && " +" + (support.length - 4)}
        </p>
      )}

      <MonoLabel
        className="mt-5 text-text-secondary"
        meta={[item.venue, addressLabel, locationLabel]}
      />
      <GenrePillRow items={genreItems} max={3} className="mt-4" />
    </header>
  );
}

function TicketPerforation() {
  return <div aria-hidden="true" className="setlist-ticket-perforation" />;
}

function setlistRowKeys(setlist: Setlist): string[] {
  const seen = new Map<string, number>();
  return setlist.map((song) => {
    const count = seen.get(song.title) ?? 0;
    seen.set(song.title, count + 1);
    return count === 0 ? song.title : `${song.title}#${count}`;
  });
}

function TicketSetlist({ setlist }: { setlist: Setlist }) {
  const { t } = useTranslation();
  if (setlist.length === 0) return null;
  const rowKeys = setlistRowKeys(setlist);

  return (
    <FormField
      kind="group"
      label={
        <MonoLabel
          as="h3"
          accent={t("artist.setlist.title")}
          meta={[t("artist.setlist.songCount", { count: setlist.length })]}
        />
      }
    >
      {(group) => (
        <div {...group} role="group">
          <HairlineList label={t("artist.setlist.title")}>
            {setlist.map((song, index) => (
              <HairlineRow
                key={rowKeys[index]}
                className="setlist-ticket-row"
                index={index + 1}
                trailing={
                  typeof song.frequency === "number" ? (
                    <MonoLabel as="span">
                      {Math.round(song.frequency * 100)}%
                    </MonoLabel>
                  ) : null
                }
              >
                {song.title}
              </HairlineRow>
            ))}
          </HairlineList>
        </div>
      )}
    </FormField>
  );
}

type TicketActionProps = Pick<
  ExpandedViewProps,
  | "item"
  | "attending"
  | "savingAttendance"
  | "playingSetlist"
  | "onToggleAttendance"
  | "onPlaySetlist"
> & { directionsUrl: string | null };

function TicketActions({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  directionsUrl,
  onToggleAttendance,
  onPlaySetlist,
}: TicketActionProps) {
  const { t } = useTranslation();
  const hasSetlist = Boolean(item.probable_setlist?.length);

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex items-center gap-3.5">
        <IconButton
          size="lg"
          label={t("radar.show.playSetlist")}
          onClick={() => void onPlaySetlist()}
          disabled={!hasSetlist}
          loading={playingSetlist}
          className="bg-accent-action text-accent-action-foreground hover:translate-y-0 hover:bg-accent-action-hover hover:text-accent-action-foreground hover:drop-shadow-none disabled:opacity-25"
        >
          <Play size={CRATE_ICON_SIZE.md} className="ml-0.5 fill-current" />
        </IconButton>
        <span
          className={cn(
            "text-sm",
            hasSetlist ? "text-text-primary" : "text-text-subtle",
          )}
        >
          {t("radar.show.playSetlist")}
        </span>
      </div>

      <ActionGroup label={t("actions.menu.more")}>
        <ActionButton
          label={attending ? t("radar.show.going") : t("radar.show.attend")}
          aria-pressed={attending}
          disabled={!item.id}
          loading={savingAttendance}
          onClick={(event) => {
            event.stopPropagation();
            void onToggleAttendance();
          }}
        >
          {attending ? (
            <CalendarCheck size={CRATE_ICON_SIZE.md} />
          ) : (
            <CalendarPlus size={CRATE_ICON_SIZE.md} />
          )}
        </ActionButton>
        {directionsUrl && (
          <ActionLink
            label={t("radar.show.directions")}
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={CRATE_ICON_SIZE.md} />
          </ActionLink>
        )}
        <ActionLink
          label={t("radar.show.getTickets")}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={CRATE_ICON_SIZE.md} />
        </ActionLink>
      </ActionGroup>
    </div>
  );
}

export function UpcomingShowExpandedView({
  item,
  artistHref,
  attending,
  savingAttendance,
  playingSetlist,
  onToggleAttendance,
  onPlaySetlist,
  onClose,
  showClose = true,
  menuAction,
}: ExpandedViewProps) {
  const { t, i18n } = useTranslation();
  const date = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateLabel = date
    ? date.toLocaleDateString(i18n.language, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const timeLabel = item.time ? item.time.slice(0, 5) : "";
  const timeRemaining = formatShowTimeRemaining(item, t);
  const directionsUrl = showDirectionsUrl(item);

  return (
    <div className="setlist-ticket relative flex h-full flex-col">
      <div className="setlist-ticket-top">
        <TicketHeader
          item={item}
          artistHref={artistHref}
          dateLabel={dateLabel}
          timeLabel={timeLabel}
          timeRemaining={timeRemaining}
          attending={attending}
          onClose={onClose}
          showClose={showClose}
          menuAction={menuAction}
        />
      </div>
      <TicketPerforation />
      <div className="setlist-ticket-bottom flex-1 px-5 pt-6 pb-5 sm:px-7 sm:pb-7">
        <TicketSetlist setlist={item.probable_setlist ?? []} />
        <TicketActions
          item={item}
          attending={attending}
          savingAttendance={savingAttendance}
          playingSetlist={playingSetlist}
          directionsUrl={directionsUrl}
          onToggleAttendance={onToggleAttendance}
          onPlaySetlist={onPlaySetlist}
        />
      </div>
    </div>
  );
}
