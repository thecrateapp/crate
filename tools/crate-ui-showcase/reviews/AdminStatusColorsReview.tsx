import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  StatusBadge,
  type StatusTone,
} from "../../../app/ui/src/components/admin/StatusBadge";

const samples: {
  tone: StatusTone;
  label: string;
  value: string;
}[] = [
  { tone: "neutral", label: "Neutral", value: "Not configured" },
  { tone: "info", label: "Info", value: "Sync available" },
  { tone: "success", label: "Success", value: "Connected" },
  { tone: "warning", label: "Warning", value: "Needs attention" },
  { tone: "danger", label: "Risk", value: "Operation failed" },
];

export function AdminStatusColorsReview() {
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl content-start gap-6 p-4 sm:p-6">
      <header className="grid gap-2 border-b border-border-quiet pb-5">
        <MonoLabel accent="26">ADMIN · STATUS COLORS</MonoLabel>
        <h1 className="m-0 font-display text-3xl font-semibold text-text-primary">
          Status has one visual language.
        </h1>
        <p className="m-0 max-w-3xl text-sm text-text-muted">
          Neutral, accent and warning tokens stay consistent across operational
          and domain surfaces. Failures use the restrained warning palette;
          destructive confirmation remains explicit in its dialog.
        </p>
      </header>

      <section
        aria-label="Admin status badge tones"
        className="grid grid-cols-1 gap-x-6 gap-y-5 rounded-md border border-border-quiet bg-panel-surface p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3"
      >
        {samples.map((sample) => (
          <FormField
            key={sample.tone}
            kind="group"
            label={sample.label}
            className="min-w-0"
          >
            <div role="group" aria-label={`${sample.label} status sample`}>
              <StatusBadge tone={sample.tone}>{sample.value}</StatusBadge>
            </div>
          </FormField>
        ))}
      </section>
    </main>
  );
}
