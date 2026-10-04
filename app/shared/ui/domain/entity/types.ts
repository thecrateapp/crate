import type { MouseEvent, ReactNode } from "react";

import type {
  ContextMenuHeader,
  ContextMenuMediaImageRenderer,
} from "@crate/ui/domain/actions/types";
import type {
  ItemActionMenuEntry,
  UseItemActionMenuReturn,
} from "@crate/ui/domain/actions/useItemActionMenu";
import type { ContextMenuPlacement } from "@crate/ui/domain/actions";
import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";
import type { MediaImageShape } from "@crate/ui/domain/media/MediaEntity";

export type EntityShape = MediaImageShape;
export type EntityMenuButtonMode = "hover" | "always" | "none";

export interface EntityActionMenu {
  getActions?: () => ItemActionMenuEntry[];
  hasActions?: boolean;
  header?: ContextMenuHeader;
  sheetLabel?: string;
  surfaceClassName?: string;
  renderMediaImage?: ContextMenuMediaImageRenderer;
  placement?: ContextMenuPlacement;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

export type EntityMenuRenderer = (
  controller: UseItemActionMenuReturn,
) => ReactNode;

export type EntityCover = Omit<MediaCoverProps, "shape" | "className">;

export interface EntityFollowOverlay {
  following: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  labelActive?: string;
  loading?: boolean;
}

export interface EntityCardOverlay {
  onPlay?: (event: MouseEvent<HTMLButtonElement>) => void;
  playing?: boolean;
  loading?: boolean;
  playLabel?: string;
  pauseLabel?: string;
  follow?: EntityFollowOverlay;
}

export interface EntityPrimaryActionProps {
  onOpen?: () => void;
  href?: string;
  external?: boolean;
  openLabel?: string;
}

export interface EntityMenuProps {
  actionMenu?: EntityActionMenu;
  renderMenu?: EntityMenuRenderer;
  menuButton?: EntityMenuButtonMode;
  menuLabel?: string;
}
