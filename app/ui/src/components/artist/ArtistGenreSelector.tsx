import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { Button } from "@crate/ui/shadcn/button";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useMemo, useState } from "react";
import { ChevronDown } from "@crate/ui/icons";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crate/ui/shadcn/popover";
import { cn } from "@crate/ui/lib/cn";

import { useApi } from "@/hooks/use-api";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface TaxonomyNode {
  slug: string;
  name: string;
  description?: string | null;
  top_level: boolean;
  parent_slugs: string[];
  alias_names: string[];
}

interface TaxonomyTreeResponse {
  nodes: TaxonomyNode[];
}

function filterTaxonomyNodes(
  nodes: TaxonomyNode[],
  search: string,
): TaxonomyNode[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.filter((node) =>
    [node.name, node.slug, ...node.alias_names]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

interface ArtistGenreSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

export function ArtistGenreSelector({
  value,
  onChange,
  disabled = false,
}: ArtistGenreSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, loading, error } = useApi<TaxonomyTreeResponse>(
    open ? "/api/genres/taxonomy/tree" : null,
  );
  const filteredNodes = useMemo(
    () => filterTaxonomyNodes(data?.nodes ?? [], search),
    [data?.nodes, search],
  );
  const labels = useMemo(
    () => new Map((data?.nodes ?? []).map((node) => [node.slug, node.name])),
    [data?.nodes],
  );
  const selectedGenres = useMemo(() => new Set(value), [value]);

  function toggle(slug: string) {
    onChange(
      value.includes(slug)
        ? value.filter((current) => current !== slug)
        : [...value, slug],
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label="Genres"
          className="h-auto min-h-10 w-full justify-between py-2 text-left"
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {value.length ? (
              value.map((slug) => (
                <GenrePill
                  key={slug}
                  item={{ name: labels.get(slug) ?? slug, slug }}
                />
              ))
            ) : (
              <span className="text-text-muted">Select canonical genres</span>
            )}
          </span>
          <ChevronDown
            data-admin-ux="artist-genres-disclosure"
            size={15}
            className="shrink-0 text-text-subtle"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        layer="dropdown"
        className="w-[min(420px,calc(100vw-2rem))] overflow-hidden p-2"
      >
        <div className="border-b border-border-quiet px-1 pb-2">
          <SearchInput
            autoFocus
            label="Search taxonomy genres"
            value={search}
            onValueChange={setSearch}
            placeholder="Search taxonomy genres..."
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {loading ? (
            <p className="px-3 py-5 text-sm text-text-muted">
              Loading taxonomy...
            </p>
          ) : error ? (
            <p className="px-3 py-5 text-sm text-state-warning-text">
              Failed to load taxonomy.
            </p>
          ) : filteredNodes.length ? (
            filteredNodes.map((node) => {
              const selected = selectedGenres.has(node.slug);
              return (
                <label
                  key={node.slug}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-surface-control-hover hover:text-accent-action-hi",
                    selected && "text-accent-action-hi",
                  )}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggle(node.slug)}
                    aria-label={node.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{node.name}</span>
                    <MonoLabel as="span" className="block truncate">
                      {node.slug}
                    </MonoLabel>
                  </span>
                </label>
              );
            })
          ) : (
            <p className="px-3 py-5 text-center text-sm text-text-muted">
              No matching genres
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
