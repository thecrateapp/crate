import { useId } from "react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { StructuredValue } from "@/components/admin/StructuredValue";
import { impactView } from "@/lib/agent-plan-technical";

export function ImpactSummary({ impact }: { impact: Record<string, unknown> }) {
  const headingId = useId();
  const { chips, details } = impactView(impact);
  if (chips.length === 0 && !details) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        className="text-xs font-normal uppercase tracking-[0.12em] text-white/40 font-mono"
      >
        Impact
      </h3>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <li key={`${index}:${chip}`}>
              <StatusBadge>{chip}</StatusBadge>
            </li>
          ))}
        </ul>
      ) : null}
      {details ? (
        <div className="text-sm text-white/80">
          <StructuredValue value={details} />
        </div>
      ) : null}
    </section>
  );
}
