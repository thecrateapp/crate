import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { FormField } from "@crate/ui/primitives/FormField";
import { Slider } from "@crate/ui/primitives/Slider";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
export function PathsPageView({
  originPanel,
  destinationPanel,
  steps,
  onStepsChange,
  creating,
  canCreate,
  onCreate,
  loading,
  error,
  onRetry,
  pathCount,
  children,
}: {
  originPanel: ReactNode;
  destinationPanel: ReactNode;
  steps: number;
  onStepsChange: (n: number) => void;
  creating: boolean;
  canCreate: boolean;
  onCreate: () => void;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  pathCount: number | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="animate-page-in grid min-w-0 gap-7 sm:py-6">
      <PageHeader title={t("paths.title")} subtitle={t("paths.subtitle")} />
      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        {originPanel}
        {destinationPanel}
      </div>
      <Card>
        <CardContent>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <FormField label={t("paths.length")}>
                {(control) => (
                  <div className="flex items-center gap-4">
                    <Slider
                      {...control}
                      min={5}
                      max={50}
                      value={steps}
                      disabled={creating}
                      onChange={(e) => onStepsChange(Number(e.target.value))}
                    />
                    <MonoLabel as="span" className="shrink-0">
                      {t("common.trackCountLabel", { count: steps })}
                    </MonoLabel>
                  </div>
                )}
              </FormField>
            </div>
            <Button loading={creating} disabled={!canCreate} onClick={onCreate}>
              {t("paths.compute")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <section className="grid min-w-0 gap-4" aria-label={t("paths.saved")}>
        <SectionHeader
          title={t("paths.saved")}
          count={pathCount ?? undefined}
        />
        {loading && pathCount == null ? (
          <LoadingState label={t("common.loadingShort")} />
        ) : error && pathCount == null ? (
          <ErrorState
            message={t("paths.toasts.loadFailed")}
            onRetry={onRetry}
            retryLabel={t("common.retry")}
          />
        ) : pathCount === 0 ? (
          <EmptyState message={t("paths.empty")} />
        ) : (
          children
        )}
      </section>
    </div>
  );
}
