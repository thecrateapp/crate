export function ExplorePill({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-4 py-2 transition-colors hover:border-accent-action/40 hover:bg-accent-action/5"
    >
      <span className="text-sm font-medium text-accent-action">{label}</span>
      {count != null && count > 0 ? (
        <span className="text-xs text-text-muted">{count}</span>
      ) : null}
    </button>
  );
}
