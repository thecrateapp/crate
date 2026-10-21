import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatStatsMinutes } from "./stats-format";
import type { StatsTape } from "./stats-types";
import { TapeBars, localToday } from "./StatsSignalTapeView";
import { buildTapeModel } from "./stats-tape-model";

export function StatsMiniTape({ tape }: { tape: StatsTape }) {
  const { t, i18n } = useTranslation();
  const model = useMemo(
    () => buildTapeModel(tape, { locale: i18n.language, today: localToday() }),
    [i18n.language, tape],
  );
  const totalMinutes = tape.points.reduce(
    (sum, point) => sum + point.minutes,
    0,
  );

  return (
    <div
      className="stats-mini-tape"
      role="img"
      aria-label={t("stats.signal.tapeLabel", {
        minutes: formatStatsMinutes(totalMinutes),
        count: model.bars.length,
      })}
    >
      <TapeBars model={model} />
    </div>
  );
}
