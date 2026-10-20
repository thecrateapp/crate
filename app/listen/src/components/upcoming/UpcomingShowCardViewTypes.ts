import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
  ReactNode,
} from "react";

import type { UpcomingItem } from "./upcoming-types";

export interface ActionMenuSlot {
  triggerRef: RefObject<HTMLButtonElement | null>;
  hasActions: boolean;
  open: boolean;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export interface CollapsedViewProps {
  artwork: ReactNode;
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  actionMenu: ActionMenuSlot;
  onToggleAttendance: () => void;
  onToggle: () => void;
}

export interface ExpandedViewProps {
  item: UpcomingItem;
  artistHref: string;
  attending: boolean;
  savingAttendance: boolean;
  playingSetlist: boolean;
  onToggleAttendance: () => void;
  onPlaySetlist: () => void;
  onClose: () => void;
  showClose?: boolean;
  menuAction?: ReactNode;
}
