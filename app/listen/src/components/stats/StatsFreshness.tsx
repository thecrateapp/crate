import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { formatStatsRelativeTime } from "./stats-format";
import type { StatsSnapshot } from "./stats-types";

const MINUTE_MS = 60_000;

export function StatsFreshness({
  snapshot,
  provisional,
}: {
  snapshot?: StatsSnapshot | null;
  /** The dashboard's `computed_until` day; the line reads the snapshot build time instead. */
  computedUntil?: string | null;
  provisional?: boolean | null;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const builtAt = snapshot?.built_at ?? null;
  useEffect(() => {
    if (!builtAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(id);
  }, [builtAt]);

  const time = formatStatsRelativeTime(builtAt, now, i18n.language);
  if (!time) return null;
  return (
    <MonoLabel as="p">
      {t("stats.freshness.updated", { time })}
      {provisional ? ` · ${t("stats.freshness.counting")}` : ""}
    </MonoLabel>
  );
}
