import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

export interface DbHeavyGateState {
  active: number;
  pending: number;
  blocking: boolean;
}

export function DbHeavyGate({ gate }: { gate: DbHeavyGateState }) {
  const hasQueuedWork = gate.pending > 0;
  const tone = gate.blocking || hasQueuedWork ? "warn" : "on";
  const status = gate.blocking
    ? "Blocking"
    : hasQueuedWork
      ? "Queued"
      : "Clear";
  const message = gate.blocking
    ? `DB-heavy work is serialized right now: ${gate.active} running, ${gate.pending} waiting. Free Dramatiq slots will stay idle until the gate clears.`
    : hasQueuedWork
      ? `${gate.pending} DB-heavy task${gate.pending === 1 ? "" : "s"} queued. They will run one at a time once a DB-heavy slot is free.`
      : "No DB-heavy serialization pressure right now.";

  return (
    <section
      role="group"
      aria-label="DB-heavy gate"
      className="border-t border-border-quiet pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <MonoLabel as="h3" size="eyebrow" tone="accent">
          DB-heavy gate
        </MonoLabel>
        <span role="status" aria-live="polite">
          <StatusDot tone={tone} label={status} />
        </span>
      </div>
      <p className="mb-0 mt-2 max-w-4xl text-sm leading-relaxed text-text-muted">
        {message}
      </p>
    </section>
  );
}
