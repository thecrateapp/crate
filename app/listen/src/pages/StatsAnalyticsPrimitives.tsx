export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-dark-card rounded-lg px-4 py-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-extrabold text-text-primary">
        {value}
      </div>
    </div>
  );
}
