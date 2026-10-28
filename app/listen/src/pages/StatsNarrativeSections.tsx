import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "@crate/ui/icons";
import { Card } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { EmptyState } from "@crate/ui/domain/states";
import { Link } from "react-router";

import type { TFunction } from "i18next";
import type { StatsAffinity } from "../components/stats/stats-types";
import { cn } from "@crate/ui/lib/cn";

export function StatsEmptyState({ t }: { t: TFunction }) {
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
      aria-current={active ? "page" : undefined}
      className={cn("pb-0.5", active ? "link-accent" : "link-meta")}
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
    <Card as="section" className="gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div>
            <MonoLabel tone="accent">{t("stats.affinity.title")}</MonoLabel>
            <StatNumber
              size="lg"
              value={t("stats.affinity.score", {
                score: affinity.affinity_score,
              })}
            />
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              {subject
                ? t("stats.affinity.subjectBody", { subject })
                : t("stats.affinity.listenerBody")}
            </p>
          </div>
        </div>
        <InfoBadge icon={Gauge}>
          {t(bandKey, { defaultValue: bandFallback })}
        </InfoBadge>
      </div>
      {reasons.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <InfoBadge key={reason}>{reason}</InfoBadge>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
