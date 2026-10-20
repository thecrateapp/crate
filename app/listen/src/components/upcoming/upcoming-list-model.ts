import type { UpcomingItem } from "./upcoming-types";

export function itemKey(item: UpcomingItem, index: number): string {
  return (
    item.event_key ||
    (item.id != null ? `${item.type}-${item.id}` : "") ||
    `${item.type}-${item.artist}-${item.release_id ?? item.venue ?? index}-${
      item.date
    }-${item.time ?? ""}`
  );
}

export function groupByMonth(
  items: UpcomingItem[],
): [string, UpcomingItem[]][] {
  const groups = new Map<string, UpcomingItem[]>();
  for (const item of items) {
    const month = (item.date || "").slice(0, 7) || "Unknown";
    const existing = groups.get(month) || [];
    existing.push(item);
    groups.set(month, existing);
  }
  return [...groups.entries()];
}

export function formatMonthLabel(
  month: string,
  locale = "en-US",
  unknownLabel = "Unknown Date",
) {
  if (month === "Unknown" || !/^\d{4}-\d{2}$/.test(month)) return unknownLabel;
  return new Date(`${month}-15T12:00:00`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}
