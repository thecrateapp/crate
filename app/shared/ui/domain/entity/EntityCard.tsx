import { memo, type MouseEvent, type ReactNode } from "react";

import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ItemActionMenuButton } from "@crate/ui/domain/actions/ItemActionMenu";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { cn } from "@crate/ui/lib/cn";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { EntityPrimaryAction } from "./EntityPrimaryAction";
import type {
  EntityCardOverlay,
  EntityCover,
  EntityFollowOverlay,
  EntityMenuButtonMode,
  EntityMenuProps,
  EntityPrimaryActionProps,
  EntityShape,
} from "./types";
import { useEntityMenu } from "./useEntityMenu";

export type EntityCardLayout = "rail" | "grid";

export interface EntityCardClassNames {
  root?: string;
  action?: string;
  artwork?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  menuButton?: string;
}

export interface EntityCardProps
  extends EntityPrimaryActionProps,
    EntityMenuProps {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  titleAccessory?: ReactNode;
  artwork?: ReactNode;
  cover?: EntityCover;
  artworkOverlay?: ReactNode;
  shape?: EntityShape;
  rank?: number;
  layout?: EntityCardLayout;
  compact?: boolean;
  overlay?: EntityCardOverlay;
  selected?: boolean;
  disabled?: boolean;
  disableItemActionTarget?: boolean;
  className?: string;
  classNames?: EntityCardClassNames;
}

const SHAPE_RADIUS_CLASS_NAME: Record<EntityShape, string> = {
  square: "rounded-lg",
  rounded: "rounded-xl",
  circle: "rounded-full",
};

const MENU_BUTTON_CLASS_NAME: Record<
  Exclude<EntityMenuButtonMode, "none">,
  string
> = {
  hover:
    "opacity-75 transition-opacity hover:opacity-100 md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100",
  always: "opacity-100",
};

const FOLLOW_BUTTON_CLASS_NAME =
  "pointer-events-auto size-10 rounded-full border border-border-subtle bg-surface-icon-control shadow-icon-control backdrop-blur-md hover:-translate-y-px";

function followRevealClassName(following: boolean) {
  return following
    ? "opacity-100"
    : "opacity-0 pointer-coarse:pointer-events-none group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100";
}

function EntityCardFollowButton({
  follow,
  className,
}: {
  follow: EntityFollowOverlay;
  className?: string;
}) {
  return (
    <FollowHeartButton
      following={follow.following}
      loading={follow.loading}
      label={follow.label}
      labelActive={follow.labelActive}
      iconSize={CRATE_ICON_SIZE.md}
      className={cn(
        FOLLOW_BUTTON_CLASS_NAME,
        followRevealClassName(follow.following),
        className,
      )}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        follow.onToggle(event);
      }}
    />
  );
}

function EntityCardOverlayControls({
  overlay,
  shape,
  disabled,
}: {
  overlay: EntityCardOverlay;
  shape: EntityShape;
  disabled: boolean;
}) {
  const { onPlay, follow } = overlay;
  if (!onPlay && !follow) return null;

  const playButton = onPlay ? (
    <PlayButton
      size="md"
      reveal="hover"
      playing={overlay.playing}
      loading={overlay.loading}
      label={overlay.playLabel}
      pauseLabel={overlay.pauseLabel}
      disabled={disabled}
      className="pointer-events-auto"
      onClick={(event) => {
        event.stopPropagation();
        onPlay(event);
      }}
    />
  ) : null;

  return (
    <div
      data-slot="entity-overlay"
      className={cn(
        "pointer-events-none absolute inset-x-[var(--content-card-padding)] top-[var(--content-card-padding)] z-10 flex aspect-square items-center justify-center transition-colors",
        SHAPE_RADIUS_CLASS_NAME[shape],
        onPlay && "md:group-hover/card:bg-surface-canvas/40",
      )}
    >
      {shape === "circle" ? (
        <div className="flex items-center justify-center gap-2">
          {playButton}
          {follow ? <EntityCardFollowButton follow={follow} /> : null}
        </div>
      ) : (
        <>
          {playButton}
          {follow ? (
            <EntityCardFollowButton
              follow={follow}
              className="absolute right-2 top-2"
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export const EntityCard = memo(function EntityCard({
  title,
  subtitle,
  meta,
  titleAccessory,
  artwork,
  cover,
  artworkOverlay,
  shape = "square",
  rank,
  layout = "rail",
  compact = false,
  overlay,
  selected = false,
  disabled = false,
  disableItemActionTarget = false,
  onOpen,
  href,
  external,
  openLabel,
  actionMenu,
  renderMenu,
  menuButton = "hover",
  menuLabel = "More actions",
  className,
  classNames,
}: EntityCardProps) {
  const centered = shape === "circle";
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    renderMenu,
    disabled: disabled || external,
    disableItemActionTarget,
    getFallbackHeader: () => ({
      type: "media",
      title,
      subtitle: typeof subtitle === "string" ? subtitle : undefined,
      imageUrl: cover?.src ?? null,
      imageAlt: title,
      imageShape: shape === "circle" ? "circle" : "square",
      fallbackIcon: cover?.fallbackIcon,
    }),
  });

  return (
    <article
      className={cn(
        "item-action-target group/card relative snap-start rounded-xl text-left transition-colors",
        layout === "grid"
          ? "w-full min-w-0"
          : cn("shrink-0", compact ? "w-[120px]" : "w-[160px]"),
        selected && "bg-text-primary/5",
        disabled && "opacity-50",
        className,
        classNames?.root,
      )}
      data-shape={shape}
      data-layout={layout}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      {...targetProps}
    >
      <EntityPrimaryAction
        onOpen={onOpen}
        href={href}
        external={external}
        openLabel={openLabel}
        disabled={disabled}
        current={selected}
        className={cn(
          "group block w-full rounded-xl p-[var(--content-card-padding)] text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          classNames?.action,
        )}
      >
        <span
          data-slot="entity-artwork"
          className={cn(
            "relative mb-[var(--content-card-gap)] block aspect-square overflow-hidden bg-text-primary/5",
            SHAPE_RADIUS_CLASS_NAME[shape],
            classNames?.artwork,
          )}
        >
          {artwork ?? (
            <MediaCover
              {...cover}
              alt={cover?.alt ?? ""}
              iconSize={cover?.iconSize ?? CRATE_ICON_SIZE.xl}
              shape={shape}
              className="size-full"
            />
          )}
          {artworkOverlay}
        </span>
        <span
          className={cn(
            "flex min-w-0 items-center gap-[var(--content-row-inline-gap)]",
            centered && "justify-center",
          )}
        >
          <span
            className={cn(
              "block min-w-0 truncate text-sm font-medium text-text-primary",
              classNames?.title,
            )}
          >
            {rank != null ? (
              <span
                data-slot="entity-rank"
                className="mr-1.5 tabular-nums text-text-muted"
              >
                {rank}
              </span>
            ) : null}
            {title}
          </span>
          {titleAccessory}
        </span>
        {subtitle != null ? (
          <span
            className={cn(
              "block truncate text-xs text-text-muted",
              centered && "text-center",
              classNames?.subtitle,
            )}
          >
            {subtitle}
          </span>
        ) : null}
        {meta != null ? (
          <span
            className={cn(
              "block truncate text-xs tabular-nums text-text-muted",
              centered && "text-center",
              classNames?.meta,
            )}
          >
            {meta}
          </span>
        ) : null}
      </EntityPrimaryAction>
      {overlay ? (
        <EntityCardOverlayControls
          overlay={overlay}
          shape={shape}
          disabled={disabled}
        />
      ) : null}
      {menuButton !== "none" ? (
        <ItemActionMenuButton
          buttonRef={controller.triggerRef}
          hasActions={controller.hasActions}
          onClick={controller.openFromTrigger}
          expanded={controller.open}
          title={menuLabel}
          className={cn(
            "absolute left-4 top-4 z-20 size-10",
            MENU_BUTTON_CLASS_NAME[menuButton],
            classNames?.menuButton,
          )}
        />
      ) : null}
      {menu}
    </article>
  );
});
