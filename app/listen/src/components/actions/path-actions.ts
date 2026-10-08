import type { TFunction } from "i18next";
import { Play, Route, Trash2 } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import { action } from "@/components/actions/shared";

export interface PathActionInput {
  onPlay: () => void | Promise<void>;
  onOpen: () => void;
  onDelete?: () => void | Promise<void>;
}

export function pathPagePath(pathId: number): string {
  return `/paths/${pathId}`;
}

export function buildPathActions(
  input: PathActionInput,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [
    action({
      key: "play",
      label: t("player.play"),
      icon: Play,
      onSelect: input.onPlay,
    }),
    action({
      key: "open",
      label: t("actions.path.open"),
      icon: Route,
      onSelect: input.onOpen,
    }),
  ];

  if (input.onDelete) {
    entries.push(
      action({
        key: "delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: input.onDelete,
      }),
    );
  }

  return entries;
}
