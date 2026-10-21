import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { StatsArtist } from "../components/stats/stats-types";
import { formatStatsMinutes } from "../components/stats/stats-format";
export function StatsArtistRankView({
  item,
  index,
  href,
  artwork,
  share = null,
}: {
  item: StatsArtist;
  index: number;
  href: string;
  artwork: ReactNode;
  /** Fraction of the period's listening, 0..1; null hides the bar. */
  share?: number | null;
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
        <div className="flex min-w-0 flex-wrap items-center gap-2 pr-10">
          <MonoLabel tone="accent">
            {t("stats.rank", { rank: index + 1 })}
          </MonoLabel>
          {item.is_new ? (
            <InfoBadge tone="accent" surface="overlay">
              {t("stats.badges.new")}
            </InfoBadge>
          ) : null}
        </div>
        <div>
          <div className="stats-artist-title line-clamp-2 text-3xl font-black leading-[0.86] tracking-display-tighter">
            {item.artist_name}
          </div>
          <MonoLabel as="div" className="mt-3 flex flex-wrap gap-2">
            <span>{t("common.playCount", { count: item.play_count })}</span>
            <span>{formatStatsMinutes(item.minutes_listened)}</span>
          </MonoLabel>
          {share !== null ? (
            <div className="mt-3">
              <ProgressHairline
                value={Math.max(0, Math.min(share, 1))}
                label={t("stats.topArtists.share", { name: item.artist_name })}
                valueText={`${Math.round(Math.max(0, Math.min(share, 1)) * 100)}%`}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
