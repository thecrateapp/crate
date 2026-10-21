import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import {
  SectionHeader,
  SectionActionButton,
} from "@crate/ui/domain/lists/SectionHeader";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@crate/ui/shadcn/card";
import type { StatsTape } from "../stats/stats-types";
import type { ReplayMix } from "./home-model";
export interface HomeListeningSignal {
  days: number;
  minutes: number;
  plays: number;
  artists: number | null;
  tape: StatsTape | null;
}
export function HomeReplaySectionView({
  replay,
  tracks,
  signalVisualization,
  signal,
  onOpenStats,
  onPlayReplay,
}: {
  replay?: ReplayMix;
  tracks: ReactNode;
  signalVisualization?: ReactNode;
  signal?: HomeListeningSignal | null;
  onOpenStats: () => void;
  onPlayReplay: () => void;
}) {
  const { t, i18n } = useTranslation();

  const formatInteger = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
      Math.round(value),
    );
  const metrics = signal
    ? [
        {
          key: "minutes",
          value: signal.minutes,
          label: t("stats.headline.minutes"),
        },
        { key: "plays", value: signal.plays, label: t("stats.headline.plays") },
        ...(signal.artists === null
          ? []
          : [
              {
                key: "artists",
                value: signal.artists,
                label: t("stats.headline.artists"),
              },
            ]),
      ]
    : [
        {
          key: "tracks",
          value: replay?.track_count ?? 0,
          label: t("home.replay.tracks"),
        },
        {
          key: "minutes",
          value: replay?.minutes_listened ?? 0,
          label: t("stats.headline.minutes"),
        },
      ];

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.listeningDna.title")}
        action={
          <SectionActionButton
            onClick={onOpenStats}
            aria-label={t("home.sections.listeningDna.action")}
          >
            {t("common.viewAll")}
          </SectionActionButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
        <Card data-home-slot="dna-summary">
          <CardHeader>
            <MonoLabel tone="accent">
              {replay?.title || t("home.replay.thisMonth")}
            </MonoLabel>
            <h3 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">
              {signal
                ? t("stats.signal.title.days", { count: signal.days })
                : t("home.replay.recap")}{" "}
              {signal ? (
                <span className="text-accent-action">
                  {t("stats.signal.title.accent")}
                </span>
              ) : null}
            </h3>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-1 flex-col gap-6">
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              {metrics.map((metric) => (
                <div key={metric.key}>
                  <dt className="sr-only">{metric.label}</dt>
                  <StatNumber
                    as="dd"
                    value={formatInteger(metric.value)}
                    label={metric.label}
                    size="md"
                  />
                </div>
              ))}
            </dl>
            {signalVisualization}
          </CardContent>
          <CardFooter>
            <Button onClick={onPlayReplay}>
              <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
              {t("home.replay.play")}
            </Button>
          </CardFooter>
        </Card>

        <Card data-home-slot="dna-tracks">
          <CardHeader>
            <MonoLabel as="h3">{t("home.replay.title")}</MonoLabel>
          </CardHeader>
          <CardContent>{tracks}</CardContent>
        </Card>
      </div>
    </section>
  );
}
