import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

const SECOND_MS = 1_000;

type CountdownUnit = {
  label: string;
  value: number;
};

function releaseTimestamp(releaseDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releaseDate);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day);
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }

  return target.getTime();
}

function pad(value: number): string {
  return String(Math.max(0, value)).padStart(2, "0");
}

export function ReleaseCountdown({ releaseDate }: { releaseDate: string }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const target = releaseTimestamp(releaseDate);
  const remaining = target == null ? 0 : Math.max(0, target - now);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [i18n.language],
  );

  useEffect(() => {
    if (target == null || target <= Date.now()) return;

    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= target) window.clearInterval(timer);
    }, SECOND_MS);
    return () => window.clearInterval(timer);
  }, [target]);

  if (target == null || target <= now) return null;

  const totalSeconds = Math.floor(remaining / SECOND_MS);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const units: CountdownUnit[] = [
    { label: t("album.releaseCountdown.days"), value: days },
    { label: t("album.releaseCountdown.hours"), value: hours },
    { label: t("album.releaseCountdown.minutes"), value: minutes },
    { label: t("album.releaseCountdown.seconds"), value: seconds },
  ];
  const formattedDate = dateFormatter.format(new Date(target));

  return (
    <section
      data-testid="release-countdown"
      aria-label={t("album.releaseCountdown.ariaLabel", {
        date: formattedDate,
      })}
      className="mt-4 w-full max-w-lg rounded-panel border border-border-quiet bg-surface-container p-4"
    >
      <MonoLabel className="flex flex-wrap items-baseline justify-between gap-3 text-accent-action">
        <span>{t("album.releaseCountdown.title")}</span>
        <time dateTime={releaseDate}>{formattedDate}</time>
      </MonoLabel>
      <dl className="mt-4 grid grid-cols-4 divide-x divide-border-quiet">
        {units.map((unit) => (
          <div key={unit.label} className="min-w-0 px-1 text-center">
            <StatNumber
              as="dd"
              value={pad(unit.value)}
              size="sm"
              align="center"
            />
            <MonoLabel as="dt" className="mt-2">
              {unit.label}
            </MonoLabel>
          </div>
        ))}
      </dl>
    </section>
  );
}
