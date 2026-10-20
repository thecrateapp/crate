import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { UpcomingTimingLabel } from "./UpcomingTimingLabel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { UpcomingDateStamp } from "./UpcomingDateStamp";
import {
  UpcomingEventMenuAction,
  UpcomingEventRowView,
} from "./UpcomingEventRowView";
import type { ActionMenuSlot } from "./UpcomingShowCardViewTypes";
import type { UpcomingItem } from "./upcoming-types";

export function UpcomingReleaseRowView({
  item,
  albumPath,
  artwork,
  actionMenu,
  articleProps,
  menu,
}: {
  item: UpcomingItem;
  albumPath: string | null;
  artwork: ReactNode;
  actionMenu: ActionMenuSlot;
  articleProps?: HTMLAttributes<HTMLElement>;
  menu?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <article
      {...articleProps}
      className="item-action-target overflow-hidden rounded-panel border border-border-quiet bg-surface-object"
    >
      <UpcomingEventRowView
        artwork={artwork}
        href={albumPath}
        openLabel={t("common.openItem", { name: item.title })}
        details={
          <>
            <span className="block truncate text-caption font-semibold text-text-primary">
              {item.title}
            </span>
            <MonoLabel as="span" className="mt-1 block truncate">
              {[item.artist, item.subtitle].filter(Boolean).join(" · ")}
            </MonoLabel>
            <UpcomingTimingLabel item={item} />
          </>
        }
        date={<UpcomingDateStamp date={item.date} locale={i18n.language} />}
        actions={
          <ActionGroup label={t("actions.menu.more")}>
            <UpcomingEventMenuAction
              menu={actionMenu}
              label={t("actions.menu.more")}
            />
          </ActionGroup>
        }
      />
      {menu}
    </article>
  );
}
