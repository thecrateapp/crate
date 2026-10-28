import type { TFunction } from "i18next";

import type { UpcomingItem } from "./upcoming-types";

import { upcomingCountdown } from "./upcoming-timing-model";

export function formatShowTimeRemaining(
  item: UpcomingItem,
  tOrNow?: TFunction | Date,
  nowArg = new Date(),
): string | null {
  if (!item.date) return null;

  const t = typeof tOrNow === "function" ? tOrNow : null;
  const now = tOrNow instanceof Date ? tOrNow : nowArg;

  const countdown = upcomingCountdown(item.date, item.time, now);
  if (!countdown) {
    const target = new Date(`${item.date}T${item.time || "23:59:59"}`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      target.getMonth() + 1 !== Number(item.date.slice(5, 7)) ||
      target.getDate() !== Number(item.date.slice(8, 10)) ||
      !(target.getTime() <= now.getTime())
    )
      return null;
    return t ? t("radar.show.time.showTime") : "Show time";
  }
  const { value: count, unit } = countdown;
  return t
    ? t(
        unit === "hours"
          ? "radar.show.time.hoursToGo"
          : "radar.show.time.daysToGo",
        { count },
      )
    : `${count} ${unit === "hours" ? (count === 1 ? "hour" : "hours") : count === 1 ? "day" : "days"} to go`;
}

function showDestination(item: UpcomingItem): string | null {
  if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    return `${item.latitude},${item.longitude}`;
  }

  const destination = [
    item.venue,
    item.address_line1,
    item.city,
    item.region,
    item.postal_code,
    item.country,
  ]
    .filter(Boolean)
    .join(", ");

  return destination || null;
}

export function showDirectionsUrl(
  item: UpcomingItem,
  provider: "auto" | "apple" | "google" = "auto",
): string | null {
  const destination = showDestination(item);
  if (!destination) return null;

  const encodedDestination = encodeURIComponent(destination);
  const isApplePlatform =
    provider === "apple" ||
    (provider === "auto" &&
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent));

  if (isApplePlatform) {
    return `https://maps.apple.com/?daddr=${encodedDestination}`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}`;
}
