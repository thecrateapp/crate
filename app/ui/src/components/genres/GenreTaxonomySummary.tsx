import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import type { TaxonomyNode } from "@/components/genres/GenreTaxonomyTree";

interface GenreTaxonomySummaryProps {
  node: TaxonomyNode | null;
  nodes: TaxonomyNode[];
  onSelectGenre: (slug: string) => void;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="genre-taxonomy-summary__metric">
      <MonoLabel as="span" size="label" tone="subtle" className="text-[9px]">
        {label}
      </MonoLabel>
      <strong>{new Intl.NumberFormat().format(value)}</strong>
    </div>
  );
}

function Share({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null | undefined;
  note?: string;
}) {
  const safeValue = value == null ? null : Math.max(0, Math.min(100, value));
  return (
    <div className="genre-taxonomy-summary__share">
      <div className="flex items-baseline justify-between gap-3">
        <MonoLabel as="span" size="label" tone="subtle" className="text-[9px]">
          {label}
        </MonoLabel>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div
        className="genre-taxonomy-summary__meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue ?? 0}
        aria-valuetext={
          safeValue == null ? "No listening data" : formatPercent(value)
        }
      >
        <span style={{ width: `${safeValue ?? 0}%` }} />
      </div>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

function RelationGroup({
  label,
  slugs,
  nodesBySlug,
  onSelectGenre,
}: {
  label: string;
  slugs: string[];
  nodesBySlug: Map<string, TaxonomyNode>;
  onSelectGenre: (slug: string) => void;
}) {
  const relations = [...new Set(slugs)]
    .map((slug) => nodesBySlug.get(slug))
    .filter((node): node is TaxonomyNode => Boolean(node));
  if (!relations.length) return null;

  return (
    <div className="genre-taxonomy-summary__relation">
      <h4 className="mb-2 mt-0">
        <MonoLabel as="span" size="label" tone="subtle" className="text-[9px]">
          {label}
        </MonoLabel>
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {relations.map((relation) => (
          <button
            key={relation.slug}
            type="button"
            className="genre-taxonomy-summary__relation-link"
            onClick={() => onSelectGenre(relation.slug)}
            aria-label={`Select ${relation.name}, ${label.toLowerCase()}`}
          >
            {relation.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GenreTaxonomySummary({
  node,
  nodes,
  onSelectGenre,
}: GenreTaxonomySummaryProps) {
  const nodesBySlug = new Map(nodes.map((item) => [item.slug, item]));
  if (!node) {
    return (
      <section className="genre-taxonomy-summary" aria-label="Genre summary">
        <header>
          <MonoLabel as="h3" tone="accent" size="eyebrow">
            Genre summary
          </MonoLabel>
        </header>
        <p className="genre-taxonomy-summary__empty">
          Select a genre in the tree or wheel to inspect its catalog reach and
          taxonomy relationships.
        </p>
      </section>
    );
  }

  const siblings = node.parent_slugs.flatMap(
    (parentSlug) => nodesBySlug.get(parentSlug)?.children_slugs ?? [],
  );
  const uniqueSiblings = [...new Set(siblings)].filter(
    (slug) => slug !== node.slug,
  );
  const eqSummary =
    node.eq_preset_source === "direct"
      ? "Direct EQ preset"
      : node.eq_preset_source === "inherited"
        ? `EQ inherited from ${nodesBySlug.get(node.eq_preset_inherited_from ?? "")?.name ?? node.eq_preset_inherited_from}`
        : "No EQ preset";

  return (
    <section
      className="genre-taxonomy-summary"
      aria-label={`Genre summary for ${node.name}`}
      aria-live="polite"
    >
      <header className="genre-taxonomy-summary__header">
        <MonoLabel as="h3" tone="accent" size="eyebrow">
          Genre summary
        </MonoLabel>
        <span className="genre-taxonomy-summary__origin">
          {node.origin === "core" ? "CORE" : "OVERLAY"}
          {node.top_level ? " · ROOT" : ""}
        </span>
      </header>

      <h2 className="genre-taxonomy-summary__title">{node.name}</h2>
      <p className="genre-taxonomy-summary__eq">{eqSummary}</p>

      <div
        className="genre-taxonomy-summary__metrics"
        aria-label="Catalog counts"
      >
        <Metric label="Artists" value={node.artist_count ?? 0} />
        <Metric label="Albums" value={node.album_count ?? 0} />
        <Metric label="Tracks" value={node.track_count ?? 0} />
      </div>

      <div className="genre-taxonomy-summary__shares">
        <Share
          label="Catalog track share"
          value={node.catalog_track_share_pct}
          note="Assigned tags · genres may overlap"
        />
        <Share
          label="Listening share · 90 days"
          value={node.listening_share_90d_pct}
          note={
            node.listening_share_90d_pct == null
              ? "No listening data for this period"
              : "Share of listens with genre metadata"
          }
        />
      </div>

      {node.mapped_raw_tags?.length ? (
        <div className="genre-taxonomy-summary__raw-tags">
          <h4 className="mb-2 mt-0">
            <MonoLabel
              as="span"
              size="label"
              tone="subtle"
              className="text-[9px]"
            >
              Mapped library tags ·{" "}
              {node.raw_tag_count ?? node.mapped_raw_tags.length}
            </MonoLabel>
          </h4>
          <p>{node.mapped_raw_tags.join(" · ")}</p>
        </div>
      ) : null}

      <div className="genre-taxonomy-summary__relations">
        <RelationGroup
          label="Parents"
          slugs={node.parent_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Shared parent (derived)"
          slugs={uniqueSiblings}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Subgenres"
          slugs={node.children_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Influenced by"
          slugs={node.influenced_by_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Influences"
          slugs={node.influences_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Related"
          slugs={node.related_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Fusion of"
          slugs={node.fusion_of_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
        <RelationGroup
          label="Fusions containing this genre"
          slugs={node.fusion_genre_slugs}
          nodesBySlug={nodesBySlug}
          onSelectGenre={onSelectGenre}
        />
      </div>
    </section>
  );
}
