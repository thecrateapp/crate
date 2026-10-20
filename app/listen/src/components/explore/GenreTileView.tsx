import type { HTMLAttributes, ReactNode } from "react";
import { Card } from "@crate/ui/shadcn/card";
import { EntityPrimaryAction } from "@crate/ui/domain/entity/EntityPrimaryAction";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@crate/ui/lib/cn";
export type GenreTileVariant = "room" | "related";
export interface GenreTileViewProps {
  variant: GenreTileVariant;
  name: string;
  kicker: string;
  detail?: string | null;
  renderImage?: (className: string) => ReactNode;
  actions?: ReactNode;
  menu?: ReactNode;
  targetProps?: HTMLAttributes<HTMLElement>;
  onOpen: () => void;
}
/** Genre imagery is content; the common Card owns solid chrome and border. */
export function GenreTileView({
  variant,
  name,
  kicker,
  detail,
  renderImage,
  actions,
  menu,
  targetProps,
  onOpen,
}: GenreTileViewProps) {
  const room = variant === "room";
  const artwork =
    renderImage?.(
      cn(
        "absolute inset-0 -z-10 size-full object-cover",
        room ? "opacity-60" : "opacity-35",
      ),
    ) ?? null;
  return (
    <Card
      as="article"
      {...targetProps}
      data-variant={variant}
      className="item-action-target group relative isolate overflow-hidden"
    >
      {artwork}
      {artwork ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 explore-genre-card-overlay-image"
        />
      ) : null}
      <EntityPrimaryAction
        onOpen={onOpen}
        className={cn(
          "grid w-full gap-4 px-6 text-left crate-focus-inset before:absolute before:inset-0 before:content-['']",
          room ? "min-h-24" : "min-h-[84px]",
        )}
      >
        <MonoLabel as="span" className="pr-10">
          {kicker}
        </MonoLabel>
        <span className="grid min-w-0 gap-2">
          <span className="font-display text-lg font-semibold leading-tight text-text-primary wrap-anywhere">
            {name}
          </span>
          {detail ? (
            room ? (
              <span className="line-clamp-2 text-xs leading-5 text-text-muted">
                {detail}
              </span>
            ) : (
              <MonoLabel as="span" className="line-clamp-2">
                {detail}
              </MonoLabel>
            )
          ) : null}
        </span>
      </EntityPrimaryAction>
      {actions}
      {menu}
    </Card>
  );
}
