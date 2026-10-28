import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";
import { LoadingState } from "@crate/ui/domain/states";
export function RadioStationRailView({
  title,
  subtitle,
  loading,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  loading: boolean;
  count: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!loading && !count) return null;
  return (
    <section className="grid min-w-0 gap-4">
      <SectionHeader title={title} subtitle={subtitle} />
      {loading && !count ? (
        <LoadingState label={t("common.loadingShort")}>
          <GridSkeleton layout="rail" variant="station" count={5} />
        </LoadingState>
      ) : (
        <MediaRail fit="columns">{children}</MediaRail>
      )}
    </section>
  );
}
