import type { TFunction } from "i18next";
import { Check, Disc3, Mic2, Music2, Ticket } from "@crate/ui/icons";
import type { NavigateFunction } from "react-router";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";
import { openExternalUrl } from "@/lib/external-links";
import { artistPagePath } from "@/lib/library-routes";
import type { UpcomingItem } from "@/components/upcoming/upcoming-model";

export interface ShowActionInput {
  item: UpcomingItem;
  attending: boolean;
  toggleAttendance: () => Promise<void>;
  playProbableSetlist: () => Promise<void>;
}

export function buildShowActions(
  input: ShowActionInput,
  { t, navigate }: { t: TFunction; navigate: NavigateFunction },
): ItemActionMenuEntry[] {
  return [
    action({
      key: "attendance",
      label: input.attending
        ? t("actions.show.removeAttendance")
        : t("actions.show.markAttending"),
      icon: Check,
      active: input.attending,
      disabled: input.item.id == null,
      onSelect: input.toggleAttendance,
    }),
    action({
      key: "setlist",
      label: t("actions.show.playProbableSetlist"),
      icon: Music2,
      disabled:
        !input.item.probable_setlist?.length || input.item.artist_id == null,
      onSelect: input.playProbableSetlist,
    }),
    action({
      key: "artist",
      label: t("actions.show.openArtist"),
      icon: Mic2,
      disabled: input.item.artist_id == null,
      onSelect: () => {
        navigate(
          artistPagePath({
            artistId: input.item.artist_id,
            artistSlug: input.item.artist_slug,
            artistName: input.item.artist,
          }),
        );
      },
    }),
    action({
      key: "tickets",
      label: t("actions.show.openTickets"),
      icon: Ticket,
      disabled: !input.item.url,
      onSelect: () => {
        if (!input.item.url) return;
        void openExternalUrl(input.item.url);
      },
    }),
  ];
}

export interface ReleaseActionInput {
  albumPath: string | null;
  artistPath: string;
}

export function buildReleaseActions(
  input: ReleaseActionInput,
  { t, navigate }: { t: TFunction; navigate: NavigateFunction },
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [];
  const albumPath = input.albumPath;
  if (albumPath) {
    entries.push(
      action({
        key: "album",
        label: t("actions.track.goToAlbum"),
        icon: Disc3,
        onSelect: () => navigate(albumPath),
      }),
    );
  }
  entries.push(
    action({
      key: "artist",
      label: t("actions.track.goToArtist"),
      icon: Mic2,
      onSelect: () => navigate(input.artistPath),
    }),
  );
  return entries;
}
