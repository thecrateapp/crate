import { ChevronLeft, ChevronRight } from "lucide-react";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";

export function ListPagination({
  label,
  itemCount,
  page,
  pageSize,
  onPageChange,
}: {
  label: string;
  itemCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.ceil(itemCount / pageSize);
  if (pageCount < 2) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, itemCount);

  return (
    <nav
      aria-label={`${label} pagination`}
      data-slot="list-pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border-quiet pt-3"
    >
      <MonoLabel as="span" aria-live="polite" className="text-text-muted">
        {start}–{end} of {itemCount} · page {page} of {pageCount}
      </MonoLabel>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Previous ${label} page`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Next ${label} page`}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
