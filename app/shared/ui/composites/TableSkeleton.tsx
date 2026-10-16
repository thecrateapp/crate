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
              <th key={index}>—</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, column) => (
                <td key={column}>—</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
