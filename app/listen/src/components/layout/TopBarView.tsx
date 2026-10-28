import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";

export function TopBarView({
  backLabel,
  forwardLabel,
  onBack,
  onForward,
  search,
  userMenu,
  hideMobileActions = false,
}: {
  backLabel: string;
  forwardLabel: string;
  onBack: () => void;
  onForward: () => void;
  search: ReactNode;
  userMenu: ReactNode;
  hideMobileActions?: boolean;
}) {
  return (
    <div className="pointer-events-none flex h-16 w-full items-center gap-2 px-3 sm:gap-4 sm:px-4">
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        <ActionButton onClick={onBack} label={backLabel}>
          <ChevronLeft size={CRATE_ICON_SIZE.md} />
        </ActionButton>
        <span className="hidden md:inline-flex">
          <ActionButton onClick={onForward} label={forwardLabel}>
            <ChevronRight size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        </span>
      </div>
      <div className="hidden flex-1 md:block" />
      {!hideMobileActions && (
        <div
          data-testid="topbar-actions"
          className="pointer-events-auto flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-4"
        >
          {search}
          {userMenu}
        </div>
      )}
    </div>
  );
}
