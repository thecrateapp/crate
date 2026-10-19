import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import type { ReactNode } from "react";

type PlayerBarActionIconButtonProps = {
  active?: boolean;
  label: string;
  onClick: () => void;
  onPrepare?: () => void;
  children: ReactNode;
  className?: string;
};

export function PlayerBarActionIconButton({
  active = false,
  label,
  onClick,
  onPrepare,
  children,
  className,
}: PlayerBarActionIconButtonProps) {
  return (
    <span className={className}>
      <ActionButton
        onClick={onClick}
        onMouseEnter={onPrepare}
        onFocus={onPrepare}
        label={label}
        aria-pressed={active}
        aria-expanded={active}
      >
        {children}
      </ActionButton>
    </span>
  );
}
