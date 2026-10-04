import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Activity, CRATE_ICON_SIZE } from "@crate/ui/icons";

import type { SoundProfile } from "@/pages/stats-page-model";
import {
  formatStatsPercent,
  type StatsGenre,
} from "@/components/stats/stats-model";
import { MiniStat } from "./StatsAnalyticsPrimitives";

export { MiniStat } from "./StatsAnalyticsPrimitives";
export { ListeningPulseCard } from "./StatsListeningPulse";

export function SignalCard({
  icon: Icon,
  label,
  title,
  body,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="stats-card rounded-panel p-5">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-eyebrow-wide text-accent-action">
        <Icon size={CRATE_ICON_SIZE.xs} />
        {label}
      </div>
      <div className="mt-3 text-xl font-black tracking-tighter text-text-primary">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}

export function SoundProfileCard({
  profile,
  genres,
  skipRate,
}: {
  profile: SoundProfile;
  genres: StatsGenre[];
  skipRate: number;
}) {
  const { t } = useTranslation();
  const genreLabels = normalizeGenreLabels(genres);

  return (
    <div className="stats-card rounded-panel p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-display text-text-primary">
            {t("stats.soundProfile.title")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("stats.soundProfile.subtitle")}
          </p>
        </div>
        <Activity className="text-accent-action" size={22} />
      </div>

      <div className="space-y-4">
        <ProfileBar
          label={t("stats.soundProfile.energy")}
          value={profile.energy}
        />
        <ProfileBar
          label={t("stats.soundProfile.movement")}
          value={profile.danceability}
        />
        <ProfileBar
          label={t("stats.soundProfile.brightness")}
          value={profile.valence}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("stats.soundProfile.avgBpm")}
          value={profile.bpm ? String(profile.bpm) : "—"}
        />
        <MiniStat
          label={t("stats.soundProfile.skipRate")}
          value={formatStatsPercent(skipRate)}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {genreLabels.map((genre) => (
          <span
            key={genre}
            className="rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs font-bold text-accent-action"
          >
            {genre}
          </span>
        ))}
        {!genreLabels.length ? (
          <span className="text-sm text-text-muted">
            {t("stats.soundProfile.genreEmpty")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ProfileBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="stats-profile-label font-bold uppercase tracking-kicker">
          {label}
        </span>
        <span className="font-black text-text-primary">{percent}%</span>
      </div>
      <div className="stats-profile-track h-3 overflow-hidden rounded-full">
        <div
          className="stats-profile-fill h-full rounded-full"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}

function normalizeGenreLabels(genres: StatsGenre[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const genre of genres) {
    for (const rawLabel of genre.genre_name.split(",")) {
      const label = rawLabel.trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
  }
  return labels.slice(0, 8);
}
