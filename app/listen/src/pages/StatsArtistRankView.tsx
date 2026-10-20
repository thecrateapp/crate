import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { StatsArtist } from "../components/stats/stats-types";
import { formatStatsMinutes } from "../components/stats/stats-format";
export function StatsArtistRankView({
  item,
  index,
  href,
  artwork,
}: {
  item: StatsArtist;
  index: number;
  href: string;
  artwork: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={href}
      className="stats-artist-card group relative block min-h-40 overflow-hidden rounded-xl p-4 transition"
    >
      {artwork}
      <div className="stats-artist-overlay absolute inset-0" />
      <div className="stats-artist-index absolute -bottom-6 -right-1 text-[8.5rem] font-black leading-none tracking-[-0.12em]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative z-10 flex min-h-32 flex-col justify-between">
        <MonoLabel tone="accent">
          {t("stats.rank", { rank: index + 1 })}
        </MonoLabel>
        <div>
          <div className="stats-artist-title line-clamp-2 text-3xl font-black leading-[0.86] tracking-display-tighter">
            {item.artist_name}
          </div>
          <MonoLabel as="div" className="mt-3 flex flex-wrap gap-2">
            <span>{t("common.playCount", { count: item.play_count })}</span>
            <span>{formatStatsMinutes(item.minutes_listened)}</span>
          </MonoLabel>
        </div>
      </div>
    </Link>
  );
}
