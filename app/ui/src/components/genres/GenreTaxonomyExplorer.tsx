import { useCallback, useState } from "react";

import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { OpsRefreshNotice } from "@/components/admin/ops-surfaces";
import {
  GenreTaxonomyTree,
  type TaxonomyNode,
  type TaxonomyTree,
} from "@/components/genres/GenreTaxonomyTree";
import {
  GenreWheel,
  type GenreWheelTaxonomyResponse,
} from "@/components/genres/GenreWheel";
import { GenreTaxonomySummary } from "@/components/genres/GenreTaxonomySummary";
import { useApi } from "@/hooks/use-api";

type ExplorerTaxonomyData = Omit<TaxonomyTree, "nodes"> &
  Omit<GenreWheelTaxonomyResponse, "nodes" | "top_level_slugs"> & {
    nodes: (TaxonomyNode & GenreWheelTaxonomyResponse["nodes"][number])[];
    top_level_slugs: string[];
  };

interface GenreTaxonomyExplorerProps {
  filter?: string;
  hideEmpty?: boolean;
  canCurate?: boolean;
  canCreatePlaylists?: boolean;
  onChanged?: () => void;
  onUnsupported?: () => void;
  selectedSlug?: string | null;
  onSelectGenre?: (slug: string | null) => void;
}

export function GenreTaxonomyExplorer({
  filter = "",
  hideEmpty = false,
  canCurate = false,
  canCreatePlaylists = false,
  onChanged,
  onUnsupported,
  selectedSlug: controlledSelectedSlug,
  onSelectGenre,
}: GenreTaxonomyExplorerProps) {
  const { data, loading, error, refetch } = useApi<ExplorerTaxonomyData>(
    "/api/genres/taxonomy/tree",
  );
  const [internalSelectedSlug, setInternalSelectedSlug] = useState<
    string | null
  >(null);
  const selectedSlug =
    controlledSelectedSlug === undefined
      ? internalSelectedSlug
      : controlledSelectedSlug;
  const selectGenre = useCallback(
    (slug: string | null) => {
      if (controlledSelectedSlug === undefined) {
        setInternalSelectedSlug(slug);
      }
      onSelectGenre?.(slug);
    },
    [controlledSelectedSlug, onSelectGenre],
  );
  const [detailTarget, setDetailTarget] = useState<HTMLDivElement | null>(null);

  if (!data) {
    if (error) {
      return (
        <OpsRefreshNotice
          message="Could not load the genre taxonomy. Try again."
          onRetry={refetch}
        />
      );
    }
    if (loading) {
      return (
        <div
          className="flex min-h-64 items-center justify-center text-sm text-text-muted"
          role="status"
        >
          Loading the genre taxonomy…
        </div>
      );
    }
    return null;
  }

  const selected = data.nodes.find((node) => node.slug === selectedSlug);

  return (
    <div className="genre-taxonomy-explorer">
      <section className="min-w-0" aria-label="Genre taxonomy tree">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <MonoLabel as="h3" tone="accent" size="eyebrow">
            Taxonomy tree
          </MonoLabel>
          <InfoBadge>{data.nodes.length} genres</InfoBadge>
        </header>
        <GenreTaxonomyTree
          filter={filter}
          hideEmpty={hideEmpty}
          canCurate={canCurate}
          canCreatePlaylists={canCreatePlaylists}
          onChanged={onChanged}
          taxonomyData={data}
          onRefetch={refetch}
          selectedSlug={selectedSlug}
          onSelectionChange={selectGenre}
          showDetailPanel={false}
          detailPortalTarget={detailTarget}
        />
      </section>

      <div className="genre-taxonomy-explorer__content">
        <div className="genre-taxonomy-explorer__visual">
          <section
            className="genre-taxonomy-explorer__wheel min-w-0"
            aria-label="Selected genre wheel"
          >
            <header className="mb-1 flex min-h-6 flex-wrap items-center justify-between gap-2">
              <MonoLabel as="h3" tone="accent" size="eyebrow">
                Genre wheel
              </MonoLabel>
              {selected ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  {selected.name}
                </span>
              ) : null}
            </header>
            {error ? (
              <div className="mb-4">
                <OpsRefreshNotice
                  message="Could not refresh the genre taxonomy. Showing the last successful map."
                  onRetry={refetch}
                />
              </div>
            ) : null}
            <GenreWheel
              taxonomyData={data}
              onRefetch={refetch}
              selectedSlug={selectedSlug}
              onSelectGenre={selectGenre}
              onUnsupported={onUnsupported}
              layout="embedded"
            />
          </section>

          <GenreTaxonomySummary
            node={selected ?? null}
            nodes={data.nodes}
            onSelectGenre={selectGenre}
          />
        </div>

        <section
          className="genre-taxonomy-management min-w-0 border-t border-border-quiet pt-4"
          aria-label={
            selected
              ? `Genre management for ${selected.name}`
              : "Genre management"
          }
        >
          <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <MonoLabel as="h3" tone="accent" size="eyebrow">
              Genre management
            </MonoLabel>
            {selected ? (
              <span className="max-w-40 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                {selected.name}
              </span>
            ) : null}
          </header>
          <div ref={setDetailTarget} className="min-w-0">
            {!selected ? (
              <p className="m-0 py-6 text-center text-sm text-text-muted">
                Select a genre from the tree or wheel to view its description,
                cover, EQ and curation controls.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
