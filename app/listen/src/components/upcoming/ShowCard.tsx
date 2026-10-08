import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Calendar } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildShowActions,
  type ShowActionInput,
} from "@/components/actions/show-actions";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  UpcomingShowCollapsedView,
  UpcomingShowExpandedView,
} from "./UpcomingShowCardViews";
import type { UpcomingItem } from "./upcoming-model";
import { useUpcomingShowActions } from "./use-upcoming-show-actions";

const COLLAPSED_HEIGHT = 88;

export type ShowCardVariant = "row" | "preview" | "feature";

interface ShowCardProps {
  item: UpcomingItem;
  variant?: ShowCardVariant;
  expanded?: boolean;
  onToggle?: () => void;
  onAttendanceChange?: (attending: boolean) => void;
}

const noop = () => undefined;

export const ShowCard = memo(function ShowCard({
  item,
  variant = "row",
  expanded: expandedProp = false,
  onToggle = noop,
  onAttendanceChange,
}: ShowCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const collapsible = variant === "row";
  const expanded = collapsible ? expandedProp : true;
  const {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  } = useUpcomingShowActions(item, onAttendanceChange);

  const latestActionInput = useRef<ShowActionInput>({
    item,
    attending,
    toggleAttendance,
    playProbableSetlist,
  });
  useEffect(() => {
    latestActionInput.current = {
      item,
      attending,
      toggleAttendance,
      playProbableSetlist,
    };
  });
  const getActions = useCallback(
    () => buildShowActions(latestActionInput.current, { t, navigate }),
    [navigate, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: item.artist,
      subtitle: item.title,
      detail: item.subtitle,
      imageUrl: resolveMaybeApiAssetUrl(item.cover_url),
      imageAlt: item.artist,
      imageShape: "square",
      fallbackIcon: Calendar,
    }),
    [item.artist, item.cover_url, item.subtitle, item.title],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });
  const actionMenuSlot = useMemo(
    () => ({
      triggerRef: controller.triggerRef,
      hasActions: controller.hasActions,
      open: controller.open,
      onOpen: controller.openFromTrigger,
    }),
    [
      controller.hasActions,
      controller.open,
      controller.openFromTrigger,
      controller.triggerRef,
    ],
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);

  useEffect(() => {
    if (expanded && contentRef.current) {
      setMeasuredHeight(contentRef.current.scrollHeight);
    }
  }, [expanded]);

  const cardHeight = !collapsible
    ? undefined
    : expanded
      ? measuredHeight > 0
        ? measuredHeight
        : "auto"
      : COLLAPSED_HEIGHT;
  const showClose = collapsible;

  return (
    <article
      className={cn(
        "item-action-target relative overflow-hidden rounded-xl border",
        expanded
          ? cn(
              variant === "feature"
                ? "border-accent-action/25 shadow-accent-action-card-featured"
                : "border-accent-action/20 shadow-accent-action-card",
              collapsible &&
                "transition-[height,border-color,box-shadow] duration-400 ease-out",
            )
          : "border-text-primary/[0.06] bg-text-primary/[0.02] transition-[height,border-color] duration-300 ease-out hover:border-accent-action/15 hover:bg-text-primary/[0.03]",
      )}
      data-variant={variant}
      data-expanded={expanded || undefined}
      style={cardHeight == null ? undefined : { height: cardHeight }}
      {...targetProps}
    >
      <div ref={contentRef}>
        {!expanded ? (
          <>
            <div className="absolute inset-0 bg-raised-surface" />
            <UpcomingShowCollapsedView
              item={item}
              attending={attending}
              savingAttendance={savingAttendance}
              actionMenu={actionMenuSlot}
              onToggleAttendance={toggleAttendance}
              onToggle={onToggle}
            />
          </>
        ) : (
          <>
            <UpcomingShowExpandedView
              item={item}
              attending={attending}
              savingAttendance={savingAttendance}
              playingSetlist={playingSetlist}
              onToggleAttendance={toggleAttendance}
              onPlaySetlist={playProbableSetlist}
              onClose={onToggle}
              showClose={showClose}
            />
            <ItemActionMenuButton
              buttonRef={controller.triggerRef}
              hasActions={controller.hasActions}
              onClick={controller.openFromTrigger}
              expanded={controller.open}
              title={t("actions.menu.more")}
              className={cn(
                "absolute top-2.5 z-20 size-7 rounded-lg bg-surface-canvas/40 text-text-primary/60 backdrop-blur-sm hover:text-text-primary",
                showClose ? "left-11" : "left-2.5",
              )}
            />
          </>
        )}
      </div>
      {menu}
    </article>
  );
});
