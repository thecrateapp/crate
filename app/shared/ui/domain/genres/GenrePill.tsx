import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { cn } from "@crate/ui/lib/cn";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";

export interface GenreProfileItem {
  name: string;
  slug?: string | null;
  source?: string | null;
  weight?: number | null;
  share?: number | null;
  percent?: number | null;
}

export function resolveGenrePercent(item: GenreProfileItem) {
  if (typeof item.percent === "number") {
    return item.percent;
  }
  if (typeof item.share === "number") {
    return Math.round(item.share * 100);
  }
  return null;
}

export function GenrePill({
  item,
  onClick,
  onRemove,
  removeLabel,
  className,
}: {
  item: GenreProfileItem;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const percent = resolveGenrePercent(item);
  const content = (
    <>
      <span className="min-w-0 truncate">{item.name.toLowerCase()}</span>
      {percent != null ? (
        <>
          {" "}
          <span
            data-slot="genre-percent"
            className="shrink-0 border-l border-border-quiet pl-2 font-mono text-filter-chip font-normal text-accent-action-hi tabular-nums"
          >
            {percent}%
          </span>
        </>
      ) : null}
    </>
  );

  const titleParts = [item.name];
  if (percent != null) titleParts.push(`${percent}%`);
  if (item.source) titleParts.push(item.source);
  const title = titleParts.join(" · ");
  const pillClassName =
    "genre-pill inline-flex min-h-8 min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1 font-mono text-filter-chip font-normal tracking-chip pointer-coarse:min-h-11";

  if (onRemove) {
    return (
      <TooltipHint content={title}>
        <span
          className={cn(
            pillClassName,
            onClick ? "p-0" : "py-0 pr-0",
            className,
          )}
          data-slot="chip"
        >
          {onClick ? (
            <button
              type="button"
              onClick={onClick}
              data-slot="chip"
              className="inline-flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1 text-left pointer-coarse:min-h-11"
            >
              {content}
            </button>
          ) : (
            content
          )}
          <button
            type="button"
            aria-label={removeLabel ?? `Remove ${item.name}`}
            onClick={onRemove}
            data-slot="chip"
            className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-text-primary/10 hover:text-text-primary pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <X size={CRATE_ICON_SIZE.micro} />
          </button>
        </span>
      </TooltipHint>
    );
  }

  if (onClick) {
    return (
      <TooltipHint content={title}>
        <button
          type="button"
          onClick={onClick}
          data-slot="chip"
          className={cn(pillClassName, "transition-colors", className)}
        >
          {content}
        </button>
      </TooltipHint>
    );
  }

  return (
    <TooltipHint content={title}>
      <span data-slot="chip" className={cn(pillClassName, className)}>
        {content}
      </span>
    </TooltipHint>
  );
}

export function GenrePillRow({
  items,
  max = 6,
  onSelect,
  className,
}: {
  items: GenreProfileItem[];
  max?: number;
  onSelect?: (item: GenreProfileItem) => void;
  className?: string;
}) {
  if (!items.length) return null;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden",
        className,
      )}
    >
      {items.slice(0, max).map((item) => (
        <GenrePill
          key={`${item.slug ?? item.name}-${item.source ?? "genre"}`}
          item={item}
          onClick={onSelect ? () => onSelect(item) : undefined}
        />
      ))}
    </div>
  );
}
