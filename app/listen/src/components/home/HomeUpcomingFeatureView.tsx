import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Calendar, CRATE_ICON_SIZE, Play, User } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ActionGroup, ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@crate/ui/shadcn/card";
import { UpcomingTimingLabel } from "../upcoming/UpcomingTimingLabel";
import type { HomeUpcomingItem } from "./home-model";

/** Portable composition; the adapter retains managed artwork, routes and playback. */
export function HomeUpcomingFeatureView({
  item,
  date,
  releasePath,
  artistPath,
  artwork,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  date: string | null;
  releasePath: string | null;
  artistPath: string;
  artwork?: ReactNode;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t } = useTranslation();
  const isShow = item.type === "show";
  return (
    <Card
      as="article"
      data-home-slot="radar-feature"
      className="relative overflow-hidden"
    >
      {artwork ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40 grayscale"
        >
          {artwork}
        </div>
      ) : null}
      {artwork ? (
        <div
          aria-hidden
          className="home-upcoming-feature-overlay pointer-events-none absolute inset-0"
        />
      ) : null}
      <CardHeader className="relative">
        <MonoLabel tone="accent">
          {t(
            isShow
              ? "home.radar.badge.nextShow"
              : "home.radar.badge.nextRelease",
          )}
        </MonoLabel>
        <h3 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-text-primary">
          {isShow ? item.artist : item.title}
        </h3>
        <MonoLabel>
          {[isShow ? item.title : item.artist, item.subtitle]
            .filter(Boolean)
            .join(" · ")}
        </MonoLabel>
      </CardHeader>
      <CardContent className="relative flex-1">
        <div className="grid gap-2">
          {date ? <MonoLabel>{date}</MonoLabel> : null}
          {isShow && item.venue && item.venue !== item.title ? (
            <MonoLabel>{item.venue}</MonoLabel>
          ) : null}
          <UpcomingTimingLabel item={item} />
          {isShow && item.user_attending ? (
            <MonoLabel tone="accent">{t("radar.show.going")}</MonoLabel>
          ) : null}
        </div>
      </CardContent>
      <CardFooter className="relative justify-between">
        {isShow && onPlaySetlist ? (
          <Button
            size="sm"
            onClick={() => onPlaySetlist(item)}
            disabled={!item.probable_setlist?.length}
          >
            <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
            {t("radar.show.playSetlist")}
          </Button>
        ) : !isShow && releasePath ? (
          <Button asChild size="sm">
            <Link to={releasePath}>{t("home.radar.openAlbum")}</Link>
          </Button>
        ) : null}
        <ActionGroup label={t("home.radar.title")}>
          <ActionButton
            label={t("home.radar.viewRadar")}
            onClick={onOpenUpcoming}
          >
            <Calendar size={CRATE_ICON_SIZE.md} />
          </ActionButton>
          {isShow ? (
            <ActionButton asChild label={t("common.artist")}>
              <Link to={artistPath}>
                <User size={CRATE_ICON_SIZE.md} />
              </Link>
            </ActionButton>
          ) : null}
        </ActionGroup>
      </CardFooter>
    </Card>
  );
}
