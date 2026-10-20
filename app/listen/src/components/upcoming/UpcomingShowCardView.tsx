import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@crate/ui/lib/cn";
import { UpcomingShowCollapsedView } from "./UpcomingShowCollapsedView";
import { UpcomingShowExpandedView } from "./UpcomingShowExpandedView";
import { UpcomingEventMenuAction } from "./UpcomingEventRowView";
import type {
  ActionMenuSlot,
  ExpandedViewProps,
} from "./UpcomingShowCardViewTypes";

export function UpcomingShowCardView({
  variant = "row",
  expanded = false,
  actionMenu,
  artwork,
  articleProps,
  menu,
  ...props
}: ExpandedViewProps & {
  variant?: "row" | "feature" | "preview";
  expanded?: boolean;
  artwork: ReactNode;
  actionMenu: ActionMenuSlot;
  articleProps?: HTMLAttributes<HTMLElement>;
  menu?: ReactNode;
}) {
  const { t } = useTranslation();
  const collapsible = variant === "row";
  const open = !collapsible || expanded;
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // Width, translated copy, artwork and refetched setlists can change after expansion.
  useEffect(() => {
    if (!open || !collapsible || !content.current) {
      setHeight(null);
      return;
    }
    const node = content.current;
    const measure = () =>
      setHeight(node.scrollHeight > 0 ? node.scrollHeight + 2 : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, collapsible]);
  return (
    <article
      {...articleProps}
      data-variant={variant}
      data-expanded={open || undefined}
      className={cn(
        "item-action-target relative overflow-hidden rounded-panel border transition-[height,border-color] duration-300 ease-snap motion-reduce:transition-none",
        open
          ? "border-transparent"
          : "border-border-quiet bg-surface-object hover:border-border-interactive",
      )}
      style={{ height: open ? (height ?? undefined) : undefined }}
    >
      <div ref={content}>
        {open ? (
          <UpcomingShowExpandedView
            {...props}
            showClose={collapsible}
            menuAction={
              <UpcomingEventMenuAction
                menu={actionMenu}
                label={t("actions.menu.more")}
              />
            }
          />
        ) : (
          <UpcomingShowCollapsedView
            item={props.item}
            attending={props.attending}
            savingAttendance={props.savingAttendance}
            actionMenu={actionMenu}
            onToggleAttendance={props.onToggleAttendance}
            onToggle={props.onClose}
            artwork={artwork}
          />
        )}
      </div>
      {menu}
    </article>
  );
}
