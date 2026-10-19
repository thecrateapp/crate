import { useId } from "react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { impactChips } from "@/lib/agent-plan-presentation";

export function ImpactSummary({ impact }: { impact: Record<string, unknown> }) {
  const headingId = useId();
  const chips = impactChips(impact ?? {});
  if (chips.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40"
      >
        Impact
      </h3>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip, index) => (
          <li key={`${index}:${chip}`}>
            <StatusBadge>{chip}</StatusBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}
