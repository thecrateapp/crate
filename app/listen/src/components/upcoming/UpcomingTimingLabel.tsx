import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { upcomingCountdown } from "./upcoming-timing-model";
import type { UpcomingItem } from "./upcoming-types";

/** Same unboxed timing role for both Radar row types. The date stays in UpcomingDateStamp. */
export function UpcomingTimingLabel({ item }: { item: UpcomingItem }) {
  const { t } = useTranslation();
  const released = item.type === "release" && !item.is_upcoming;
  const countdown = released ? null : upcomingCountdown(item.date, item.time);
  if (!released && !countdown) return null;
  return (
    <MonoLabel
      as="span"
      data-slot="upcoming-timing"
      className="mt-1 block"
      accent={
        countdown
          ? t(
              countdown.unit === "hours"
                ? "radar.show.time.hoursToGo"
                : "radar.show.time.daysToGo",
              { count: countdown.value },
            )
          : undefined
      }
    >
      {released ? t("radar.release.released") : null}
    </MonoLabel>
  );
}
