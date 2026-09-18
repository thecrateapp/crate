import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "@crate/ui/icons";

import { CrateCard } from "@/components/CrateCard";
import { CrateEditor } from "@/components/CrateEditor";
import { useApi } from "@/hooks/use-api";
import type { CrateSummary } from "@/pages/crates-types";

export function Crates() {
  const { t } = useTranslation();
  const {
    data: crates,
    loading,
    error,
    refetch,
  } = useApi<CrateSummary[]>("/api/me/crates");
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (selectedCrateId || creating) {
    return (
      <CrateEditor
        crateId={selectedCrateId}
        onBack={() => {
          setSelectedCrateId(null);
          setCreating(false);
        }}
        onCreated={(crateId) => {
          setCreating(false);
          setSelectedCrateId(crateId);
          refetch();
        }}
        onDeleted={() => {
          setSelectedCrateId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="hidden text-lg font-semibold text-foreground md:block">
          {t("library.crates.title")}
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={17} />
          {t("library.crates.new")}
        </button>
      </div>

      {loading && !crates ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : error ? (
        <p role="alert" className="py-10 text-center text-sm text-destructive">
          {t("library.crates.loadFailed")}
        </p>
      ) : crates?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {crates.map((crate) => (
            <CrateCard
              key={crate.id}
              crate={crate}
              onOpen={() => setSelectedCrateId(crate.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 px-5 py-12 text-center">
          <h3 className="text-base font-semibold text-foreground">
            {t("library.crates.emptyTitle")}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {t("library.crates.emptyDescription")}
          </p>
        </div>
      )}
    </section>
  );
}
