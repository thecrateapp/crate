import { useTranslation } from "react-i18next";
import { HairlineRow } from "@crate/ui/primitives/HairlineList";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { UpcomingDateStamp } from "../upcoming/UpcomingDateStamp";
import { UpcomingTimingLabel } from "../upcoming/UpcomingTimingLabel";
import type { HomeUpcomingItem } from "./home-model";
export function UpcomingPreviewRow({
  item,
  onClick,
}: {
  item: HomeUpcomingItem;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <HairlineRow
      asChild
      truncate={false}
      trailing={<UpcomingDateStamp date={item.date} locale={i18n.language} />}
    >
      <button type="button" onClick={onClick}>
        <span className="grid min-w-0 gap-2">
          <span>{item.type === "show" ? item.artist : item.title}</span>
          <MonoLabel as="span">
            {[item.type === "show" ? item.title : item.artist, item.subtitle]
              .filter(Boolean)
              .join(" · ")}
          </MonoLabel>
          <UpcomingTimingLabel item={item} />
          {item.user_attending && item.type === "show" ? (
            <MonoLabel as="span" tone="accent">
              {t("radar.show.going")}
            </MonoLabel>
          ) : null}
        </span>
      </button>
    </HairlineRow>
  );
}
