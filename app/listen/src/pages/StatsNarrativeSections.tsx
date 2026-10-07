import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Users, Gauge } from "@crate/ui/icons";
import { EmptyState } from "@crate/ui/domain/states";
import { Link } from "react-router";

import type { StatsPageController } from "@/pages/use-stats-page-controller";
import type { StatsAffinity } from "@/components/stats/stats-model";
import { cn } from "@/lib/utils";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

const NARRATIVE_TONES = [
  "stats-narrative-tone-cool",
  "stats-narrative-tone-warm",
  "stats-narrative-tone-alert",
];

export function StatsRecapSection({
  highlights,
  t,
}: {
  highlights: StatsPageController["recapHighlights"];
  t: StatsPageController["t"];
}) {
  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-3">
      {highlights.length > 0 ? (
        highlights.map((item, index) => (
          <NarrativeTile key={item.title} index={index} {...item} />
        ))
      ) : (
        <div className="stats-card-empty rounded-panel border border-dashed p-6 text-sm lg:col-span-3">
          {t("stats.empty.recap")}
        </div>
      )}
    </section>
  );
}

export function StatsEmptyState({ t }: { t: StatsPageController["t"] }) {
  return (
    <EmptyState
      variant="dashed"
      titleAs="h2"
      title={t("stats.empty.title")}
      description={t("stats.empty.body")}
      className="mt-8"
    />
  );
}

export function ScopeLink({
  active,
  to,
  children,
}: {
  active: boolean;
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-kicker transition-colors",
        active
          ? "border-accent-action/30 bg-accent-action/15 text-accent-action"
          : "stats-scope-link-inactive",
      )}
    >
      {children}
    </Link>
  );
}

export function AffinityCard({
  affinity,
  subject,
}: {
  affinity?: StatsAffinity | null;
  subject?: string | null;
}) {
  const { t } = useTranslation();
  if (!affinity) return null;

  const reasons = affinity.affinity_reasons ?? [];
  const bandKey = "stats.affinity.band." + affinity.affinity_band;
  const bandFallback = affinity.affinity_band.replace("_", " ");
  return (
    <section className="stats-affinity-card mt-8 overflow-hidden rounded-panel p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-accent-action/25 bg-accent-action/15 text-accent-action">
            <Users size={CRATE_ICON_SIZE.lg} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-overline text-accent-action">
              {t("stats.affinity.title")}
            </div>
            <h2 className="mt-2 text-3xl font-black uppercase leading-none tracking-display-tight text-text-primary">
              {t("stats.affinity.score", {
                score: affinity.affinity_score,
              })}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              {subject
                ? t("stats.affinity.subjectBody", { subject })
                : t("stats.affinity.listenerBody")}
            </p>
          </div>
        </div>
        <CrateBadge size="md" icon={Gauge}>
          {t(bandKey, { defaultValue: bandFallback })}
        </CrateBadge>
      </div>
      {reasons.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <CrateBadge key={reason} size="md">
              {reason}
            </CrateBadge>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NarrativeTile({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  index: number;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "stats-narrative-tile rounded-panel p-5",
        NARRATIVE_TONES[index % NARRATIVE_TONES.length],
      )}
    >
      <div className="stats-muted-label text-xs font-black uppercase tracking-overline">
        {t("stats.narrative.signal", {
          number: String(index + 1).padStart(2, "0"),
        })}
      </div>
      <div className="mt-3 text-xl font-black tracking-tighter text-text-primary">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}
