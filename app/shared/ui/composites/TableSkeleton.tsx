import { Skeleton } from "@crate/ui/shadcn/skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  label?: string;
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
  label = "Loading",
}: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      data-slot="skeleton-table"
      className="min-w-0 overflow-hidden"
    >
      <span className="sr-only">{label}</span>
      <table aria-hidden="true" className="crate-skeleton-table">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, index) => (
              <th key={index}>
                <Skeleton className="h-3 w-1/2" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, column) => (
                <td key={column}>
                  <Skeleton
                    className={
                      column === columns - 1 ? "h-3 w-1/3" : "h-3 w-3/4"
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
