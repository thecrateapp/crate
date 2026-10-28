import { useTranslation } from "react-i18next";
import { CalendarCheck, CalendarPlus, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { UpcomingTimingLabel } from "./UpcomingTimingLabel";
import { UpcomingDateStamp } from "./UpcomingDateStamp";
import {
  UpcomingEventMenuAction,
  UpcomingEventRowView,
} from "./UpcomingEventRowView";
import type { CollapsedViewProps } from "./UpcomingShowCardViewTypes";

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
  onToggle,
  artwork,
}: CollapsedViewProps) {
  const { t, i18n } = useTranslation();
  const support = (item.lineup || []).slice(1);
  return (
    <UpcomingEventRowView
      artwork={artwork}
      details={
        <>
          <span className="flex items-center gap-1.5">
            <span className="truncate text-caption font-semibold text-text-primary">
              {item.artist}
            </span>
            {attending && <StatusDot title={t("radar.show.attending")} />}
          </span>
          <MonoLabel
            as="span"
            className="mt-1 block truncate"
            meta={[item.venue, item.city]}
          />
          {support.length > 0 && (
            <MonoLabel as="span" className="mt-0.5 block truncate">
              {t("radar.show.withSupportPrefix")}{" "}
              {support.slice(0, 3).join(", ")}
              {support.length > 3 && ` +${support.length - 3}`}
            </MonoLabel>
          )}
          <UpcomingTimingLabel item={item} />
        </>
      }
      date={<UpcomingDateStamp date={item.date} locale={i18n.language} />}
      onToggle={onToggle}
      expanded={false}
      actions={
        <div className="flex flex-col">
          <ActionGroup label={t("actions.menu.more")}>
            <UpcomingEventMenuAction
              menu={actionMenu}
              label={t("actions.menu.more")}
            />
          </ActionGroup>
          <ActionGroup label={t("radar.show.attend")}>
            <ActionButton
              label={
                attending
                  ? t("radar.show.attending")
                  : t("actions.show.markAttending")
              }
              loading={savingAttendance}
              disabled={!item.id}
              aria-pressed={attending}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void onToggleAttendance()}
            >
              {attending ? (
                <CalendarCheck size={CRATE_ICON_SIZE.md} />
              ) : (
                <CalendarPlus size={CRATE_ICON_SIZE.md} />
              )}
            </ActionButton>
          </ActionGroup>
        </div>
      }
    />
  );
}
