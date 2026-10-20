/** Shared local-calendar countdown for releases and shows; unknown/past dates have no countdown. */
export function upcomingCountdown(
  date: string,
  time?: string,
  now: Date = new Date(),
): { value: number; unit: "days" | "hours" } | null {
  if (!date) return null;
  const target = new Date(`${date}T${time || "23:59:59"}`);
  if (
    Number.isNaN(target.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    target.getMonth() + 1 !== Number(date.slice(5, 7)) ||
    target.getDate() !== Number(date.slice(8, 10))
  )
    return null;

  const millisecondsRemaining = target.getTime() - now.getTime();
  if (millisecondsRemaining <= 0) return null;

  const hoursRemaining = Math.max(
    1,
    Math.ceil(millisecondsRemaining / (60 * 60 * 1000)),
  );
  if (hoursRemaining < 48) {
    return { value: hoursRemaining, unit: "hours" };
  }
  return { value: Math.ceil(hoursRemaining / 24), unit: "days" };
}
