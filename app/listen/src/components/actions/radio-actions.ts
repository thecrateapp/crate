import type { TFunction } from "i18next";
import { Disc3, Mic2, Radio, Tag } from "@crate/ui/icons";
import type { NavigateFunction } from "react-router";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";

export type RadioSeedKind = "artist" | "album" | "track" | "genre";

export interface RadioActionInput {
  onStart: () => void | Promise<void>;
  disabled?: boolean;
  seedKind: RadioSeedKind;
  seedPath?: string | null;
}

const SEED_LABEL_KEY: Record<RadioSeedKind, string> = {
  artist: "actions.track.goToArtist",
  album: "actions.track.goToAlbum",
  track: "actions.track.goToAlbum",
  genre: "actions.genre.open",
};

export function buildRadioActions(
  input: RadioActionInput,
  { t, navigate }: { t: TFunction; navigate: NavigateFunction },
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [
    action({
      key: "start",
      label: t("actions.radio.start"),
      icon: Radio,
      disabled: input.disabled,
      onSelect: input.onStart,
    }),
  ];

  const seedPath = input.seedPath;
  if (seedPath) {
    entries.push(
      action({
        key: "open-seed",
        label: t(SEED_LABEL_KEY[input.seedKind]),
        icon:
          input.seedKind === "genre"
            ? Tag
            : input.seedKind === "artist"
              ? Mic2
              : Disc3,
        onSelect: () => navigate(seedPath),
      }),
    );
  }

  return entries;
}
