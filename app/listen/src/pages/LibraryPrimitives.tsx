export function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-text-primary/5 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-text-primary">{value ?? 0}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}
