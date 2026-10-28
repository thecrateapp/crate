import { useId, useMemo, useState } from "react";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

export const RELATION_EDITOR_CONFIG = [
  {
    key: "parent",
    label: "Parents",
    helper: "Subgenre relationship: this genre sits under these parent slugs.",
    field: "parent_slugs",
  },
  {
    key: "related",
    label: "Related",
    helper:
      "Genres connected by sound, scene or discovery. This symmetric link does not define hierarchy.",
    field: "related_slugs",
  },
  {
    key: "influenced_by",
    label: "Influenced by",
    helper: "Lineage inputs that shaped this genre.",
    field: "influenced_by_slugs",
  },
  {
    key: "fusion_of",
    label: "Fusion of",
    helper: "Component genres blended into this genre.",
    field: "fusion_of_slugs",
  },
] as const;

export type TaxonomyRelationConfig = (typeof RELATION_EDITOR_CONFIG)[number];

export interface TaxonomyRelationOption {
  slug: string;
  name: string;
}

interface TaxonomyDerivedRelationFieldProps {
  label: string;
  helper: string;
  value: string[];
  options: TaxonomyRelationOption[];
}

/** Shows the read-only inverse of a persisted taxonomy relationship. */
export function TaxonomyDerivedRelationField({
  label,
  helper,
  value,
  options,
}: TaxonomyDerivedRelationFieldProps) {
  const relations = [...new Set(value)]
    .map((slug) => options.find((option) => option.slug === slug))
    .filter((option): option is TaxonomyRelationOption => Boolean(option));

  return (
    <section
      className="min-w-0 rounded-md border border-border-quiet bg-card p-4"
      aria-label={`${label} relationships`}
    >
      <div className="crate-form-field">
        <div className="min-w-0">
          <MonoLabel as="div" tone="accent" size="eyebrow">
            {label}
          </MonoLabel>
          <p className="m-0 mt-1 text-xs leading-5 text-text-muted">{helper}</p>
        </div>

        {relations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {relations.map((relation) => (
              <GenrePill
                key={relation.slug}
                item={{
                  name: relation.name,
                  slug: relation.slug,
                  source: relation.slug,
                }}
                className="border-border bg-transparent text-text-secondary"
              />
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-md border border-border bg-raised-surface px-3 py-2 text-xs text-text-muted">
            No genres linked in this direction.
          </p>
        )}
      </div>
    </section>
  );
}

export interface StagedTaxonomyRelation {
  confidence: number;
  reasoning: string;
}

interface TaxonomyRelationFieldProps {
  config: TaxonomyRelationConfig;
  value: string[];
  options: TaxonomyRelationOption[];
  sourceSlug: string;
  stagedProposal?: StagedTaxonomyRelation;
  onChange: (next: string[]) => void;
}

function normalizeRelationSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function sameTaxonomyRelations(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  const normalizedFirst = first.map(normalizeRelationSlug).sort();
  const normalizedSecond = second.map(normalizeRelationSlug).sort();
  return normalizedFirst.every(
    (slug, index) => slug === normalizedSecond[index],
  );
}

export function TaxonomyRelationField({
  config,
  value,
  options,
  sourceSlug,
  stagedProposal,
  onChange,
}: TaxonomyRelationFieldProps) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = useMemo(() => new Set(value), [value]);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const candidates = options
      .filter((option) => {
        if (option.slug === sourceSlug || selected.has(option.slug)) {
          return false;
        }
        if (!normalizedQuery) return true;
        return (
          option.slug.includes(normalizedQuery) ||
          option.name.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((a, b) => {
        const aExact = a.slug.startsWith(normalizedQuery) ? 0 : 1;
        const bExact = b.slug.startsWith(normalizedQuery) ? 0 : 1;
        return aExact - bExact || a.name.localeCompare(b.name);
      });
    return candidates.slice(0, 8);
  }, [normalizedQuery, options, selected, sourceSlug]);

  const addSlug = (slug: string) => {
    const normalized = normalizeRelationSlug(slug);
    if (!normalized || normalized === sourceSlug || selected.has(normalized)) {
      return;
    }
    onChange([...value, normalized]);
    setQuery("");
    setFocused(false);
  };

  const removeSlug = (slug: string) => {
    onChange(value.filter((item) => item !== slug));
  };

  return (
    <section className="min-w-0 rounded-md border border-border-quiet bg-card p-4">
      <div className="crate-form-field">
        <div className="min-w-0">
          <MonoLabel as="div" tone="accent" size="eyebrow">
            {config.label}
          </MonoLabel>
          <p className="m-0 mt-1 text-xs leading-5 text-text-muted">
            {config.helper}
          </p>
        </div>

        <div className="rounded-md border border-border bg-raised-surface p-2 transition focus-within:border-accent-action/40">
          {value.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {value.map((slug) => {
                const option = options.find((item) => item.slug === slug);
                return (
                  <GenrePill
                    key={`${config.key}-${slug}`}
                    item={{
                      name: option?.name ?? slug,
                      slug,
                      source: slug,
                    }}
                    onRemove={() => removeSlug(slug)}
                    removeLabel={`Remove ${slug}`}
                    className="border-accent-action/20 bg-accent-action/10 text-accent-action-hi"
                  />
                );
              })}
            </div>
          ) : null}
          <div className="relative">
            <label htmlFor={inputId} className="sr-only">
              Search {config.label.toLowerCase()}
            </label>
            <input
              id={inputId}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setFocused(true);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (suggestions[0]) addSlug(suggestions[0].slug);
                }
                if (event.key === "Escape") setFocused(false);
              }}
              className="w-full bg-transparent px-1 py-1 font-mono text-xs text-foreground placeholder:text-text-muted"
              placeholder="Search taxonomy genres…"
            />
            {focused && suggestions.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-md border border-border-quiet bg-card shadow-lg">
                {suggestions.map((option) => (
                  <button
                    key={option.slug}
                    type="button"
                    className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:text-accent-action-hi"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addSlug(option.slug)}
                  >
                    <span className="font-medium">{option.name}</span>
                    <span className="font-mono text-text-muted">
                      {option.slug}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {stagedProposal ? (
        <div className="mt-3 rounded-md border border-accent-action/20 bg-accent-action/5 px-3 py-2 text-xs leading-5 text-text-muted">
          <span className="font-mono text-accent-action-hi">
            AI {Math.round(stagedProposal.confidence * 100)}%
          </span>
          {stagedProposal.reasoning
            ? ` · ${stagedProposal.reasoning}`
            : " · staged from inference"}
        </div>
      ) : null}
    </section>
  );
}
