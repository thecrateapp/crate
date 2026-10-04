import type { TFunction } from "i18next";
import { notify } from "@crate/ui/lib/notify";
import { Radio, Share2, Tag } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";
import type { PlayerActionsValue } from "@/contexts/player-context";
import { startShapedRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";

export interface GenreMenuData {
  slug: string;
  name: string;
  imageUrl?: string | null;
}

export interface GenreActionInput {
  genre: GenreMenuData;
  onOpen: () => void;
  onStartRadio?: () => void | Promise<void>;
  onShare?: () => void | Promise<void>;
}

export function genrePagePath(slug: string): string {
  return `/explore?genre=${encodeURIComponent(slug)}`;
}

export async function startGenreRadio(
  slug: string,
  playAll: PlayerActionsValue["playAll"],
  t: TFunction,
) {
  try {
    const radio = await startShapedRadio("seeded", "genre", slug);
    if (!radio?.tracks.length) {
      notify.info(t("genre.toasts.radioUnavailable"));
      return;
    }
    playAll(radio.tracks, 0, radio.source);
  } catch {
    notify.error(t("genre.toasts.radioFailed"));
  }
}

export function shareGenre(genre: GenreMenuData, t: TFunction) {
  openShareSheet({
    kind: "genre",
    title: genre.name,
    subtitle: t("genre.kind"),
    imageUrl: genre.imageUrl,
    url: publicShareUrl(genrePagePath(genre.slug)),
  });
}

export function buildGenreActions(
  input: GenreActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [
    action({
      key: "open",
      label: t("actions.genre.open"),
      icon: Tag,
      onSelect: input.onOpen,
    }),
  ];

  if (input.onStartRadio) {
    entries.push(
      action({
        key: "play-radio",
        label: t("genre.actions.playRadio"),
        icon: Radio,
        onSelect: input.onStartRadio,
      }),
    );
  }

  if (input.onShare) {
    entries.push(
      action({
        key: "share",
        label: t("genre.actions.share"),
        icon: Share2,
        onSelect: input.onShare,
      }),
    );
  }

  return entries;
}
