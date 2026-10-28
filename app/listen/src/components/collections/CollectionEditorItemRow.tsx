import type { ReactNode } from "react";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";

/** Item identity, managed artwork and contextual controls; sorting stays with its adapter. */
export function CollectionEditorItemRow({
  title,
  subtitle,
  artwork,
  rank,
  dragHandle,
  meta,
  reorderControls,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  artwork: ReactNode;
  rank?: number;
  dragHandle?: ReactNode;
  meta?: ReactNode;
  reorderControls?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <EntityRow
      title={title}
      subtitle={subtitle}
      rank={rank}
      leading={
        <div className="flex shrink-0 items-center gap-2">
          {dragHandle}
          {artwork}
        </div>
      }
      meta={
        meta || reorderControls ? (
          <span className="flex flex-wrap items-center gap-2">
            {meta}
            {reorderControls}
          </span>
        ) : undefined
      }
      trailing={actions}
    />
  );
}
