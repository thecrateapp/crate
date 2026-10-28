import {
  EntityRow,
  type EntityRowProps,
} from "@crate/ui/domain/entity/EntityRow";
import { cn } from "@crate/ui/lib/cn";
import { isOfflineBusy, type OfflineItemState } from "@crate/ui/lib/offline";
export function playlistRowSurfaceClass(
  state: OfflineItemState,
): string | undefined {
  if (state === "ready") {
    return "pointer-fine:hover:bg-accent-action/[0.08] bg-accent-action/[0.04] focus-within:bg-accent-action/[0.08]";
  }
  if (isOfflineBusy(state)) {
    return "pointer-fine:hover:bg-accent-action/[0.09] bg-accent-action/[0.05] focus-within:bg-accent-action/[0.09]";
  }
  if (state === "error") {
    return "pointer-fine:hover:bg-state-warning/[0.09] bg-state-warning/[0.05] focus-within:bg-state-warning/[0.09]";
  }
  return "pointer-fine:hover:bg-accent-action/[0.04] focus-within:bg-text-primary/5";
}

/** Actual collection playlist row frame; offline state keeps its stronger feedback. */
export function PlaylistListRowView({
  offlineState,
  className,
  ...props
}: EntityRowProps & { offlineState: OfflineItemState }) {
  return (
    <EntityRow
      {...props}
      className={cn(playlistRowSurfaceClass(offlineState), className)}
    />
  );
}
