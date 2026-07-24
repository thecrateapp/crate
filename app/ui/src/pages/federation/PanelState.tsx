import type { ReactNode } from "react";

export function PanelState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: ReactNode;
}) {
  if (loading)
    return <p className="text-sm text-white/45">Loading federation data…</p>;
  if (error)
    return (
      <p className="text-sm text-red-400">Federation data is unavailable.</p>
    );
  return children;
}
