import type { ReactNode, RefObject } from "react";
import type { CrateIcon } from "@crate/ui/icons";

export interface ContextMenuMediaHeader {
  type: "media";
  title: string;
  subtitle?: string;
  detail?: string;
  imageUrl?: string | null;
  imageAlt?: string;
  imageOnError?: () => void;
  imageShape?: "square" | "circle";
  fallbackIcon?: CrateIcon;
}

export type ContextMenuHeader = ContextMenuMediaHeader;

export type ContextMenuEntry =
  | {
      type?: "action";
      key: string;
      label: string;
      icon?: CrateIcon;
      active?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void | Promise<void>;
    }
  | {
      type: "disclosure";
      key: string;
      label: string;
      icon?: CrateIcon;
      disabled?: boolean;
      expanded: boolean;
      onToggle: () => void;
      items: ContextMenuEntry[];
    }
  | { type: "divider"; key: string }
  | { type: "label"; key: string; label: string };

export interface ContextMenuProps {
  items: ContextMenuEntry[];
  header?: ContextMenuHeader | ReactNode;
  open: boolean;
  position: { x: number; y: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  className?: string;
}

export interface MobileActionSheetProps {
  children: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  open: boolean;
  className?: string;
}

export interface DesktopMenuEnvironment {
  isDesktop: boolean;
  canHover: boolean;
  isTouchDominant: boolean;
  isCapacitor?: boolean;
  forceMobileSheet?: boolean;
}
