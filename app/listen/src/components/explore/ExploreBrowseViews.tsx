import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { EntityPrimaryAction } from "@crate/ui/domain/entity/EntityPrimaryAction";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import type { MoodPreset } from "./explore-browse-types";

export function ExploreFeatureCard({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <EntityPrimaryAction
      onOpen={onClick}
      openLabel={title}
      className="block w-full rounded-panel text-left crate-focus-inset"
    >
      <Card className="min-h-36">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>
      </Card>
    </EntityPrimaryAction>
  );
}

export function BrowseReadState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      {loading ? <LoadingState label={t("common.loadingShort")} /> : null}
      {error ? (
        <ErrorState
          message={t("search.errors.tryAgain")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : null}
      {children}
    </>
  );
}

export function BrowseDetailFrame({
  title,
  count,
  onBack,
  children,
}: {
  title: ReactNode;
  count?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <PageHeader
        size="md"
        title={title}
        back={
          <BackLink variant="icon" label={t("common.back")} onClick={onBack} />
        }
        meta={count != null ? <MonoLabel>{count}</MonoLabel> : undefined}
      />
      {children}
    </div>
  );
}

export function ExploreDecades({
  decades,
  onOpen,
}: {
  decades: string[];
  onOpen: (decade: string) => void;
}) {
  const { t } = useTranslation();
  if (!decades.length) return null;
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("explore.timeTunnels.title")}
        subtitle={t("explore.timeTunnels.subtitle")}
      />
      <div className="flex flex-wrap gap-2">
        {decades.map((decade) => (
          <FilterChip
            key={decade}
            variant="action"
            onClick={() => onOpen(decade)}
          >
            {decade}
          </FilterChip>
        ))}
      </div>
    </section>
  );
}

const MOOD_LABEL_KEY: Record<string, string> = {
  energetic: "explore.moods.names.energetic",
  chill: "explore.moods.names.chill",
  dark: "explore.moods.names.dark",
  happy: "explore.moods.names.happy",
  melancholy: "explore.moods.names.melancholy",
  intense: "explore.moods.names.intense",
  groovy: "explore.moods.names.groovy",
  acoustic: "explore.moods.names.acoustic",
};
export function ExploreMoodChoices({
  moods,
  pending,
  onPlay,
}: {
  moods: MoodPreset[];
  pending: string | null;
  onPlay: (name: string) => void;
}) {
  const { t } = useTranslation();
  if (!moods.length) return null;
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("explore.moods.title")}
        subtitle={t("explore.moods.subtitle")}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {moods.map((mood) => (
          <div key={mood.name} className="grid min-w-0 gap-2">
            <Button
              variant="outline"
              size="lg"
              disabled={pending !== null}
              loading={pending === mood.name}
              onClick={() => onPlay(mood.name)}
            >
              {MOOD_LABEL_KEY[mood.name]
                ? t(MOOD_LABEL_KEY[mood.name]!)
                : mood.name}
            </Button>
            <MonoLabel>
              {t("common.trackCount", { count: mood.track_count })}
            </MonoLabel>
          </div>
        ))}
      </div>
    </section>
  );
}
