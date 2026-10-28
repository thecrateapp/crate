import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@crate/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { useAuth } from "@/contexts/AuthContext";
import {
  formatCount,
  formatDuration,
  invocationErrorText,
  invocationStatusView,
} from "@/lib/ai-models";

import type { Invocation, Snapshot } from "./types";

const PROBE_LABEL = "Compatibility test";

/** The readable name of what made a call. */
export function invocationFeatureLabel(
  invocation: Invocation,
  snapshot: Snapshot,
): string {
  if (invocation.invocation_kind === "probe") return PROBE_LABEL;
  return (
    snapshot.actions.find((action) => action.id === invocation.action_id)
      ?.label ?? "Unknown feature"
  );
}

function tokens(value: number | null): string {
  return value == null ? "Unknown" : formatCount(value);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/6 py-2 last:border-b-0">
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right text-white">{children}</dd>
    </div>
  );
}

export function InvocationSheet({
  invocation,
  snapshot,
  open,
  onOpenChange,
}: {
  invocation: Invocation;
  snapshot: Snapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canManageTasks = useAuth().hasCapability("ops.tasks.manage");
  const status = invocationStatusView(invocation.status);
  const reported =
    invocation.reported_model &&
    invocation.reported_model !== invocation.model_id
      ? invocation.reported_model
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {invocationFeatureLabel(invocation, snapshot)}
          </SheetTitle>
          <SheetDescription>One call Crate made to a model.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6 text-sm">
          <dl>
            <Field label="When">
              <RelativeTime value={invocation.created_at} />
            </Field>
            <Field label="Model">
              <p>{invocation.model_id}</p>
              {reported ? (
                <p className="text-white/50">Reported as {reported}</p>
              ) : null}
            </Field>
            <Field label="Result">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </Field>
            <Field label="Duration">
              {formatDuration(invocation.duration_ms)}
            </Field>
            {invocation.error_code ? (
              <Field label="Error">
                {invocationErrorText(invocation.error_code)}
              </Field>
            ) : null}
          </dl>

          <section className="space-y-1">
            <h3 className="font-semibold text-white/80 font-display">Tokens</h3>
            <dl>
              <Field label="Input">{tokens(invocation.input_tokens)}</Field>
              <Field label="Cached input">
                {tokens(invocation.cached_input_tokens)}
              </Field>
              <Field label="Output">{tokens(invocation.output_tokens)}</Field>
              <Field label="Thinking">
                {tokens(invocation.thought_tokens)}
              </Field>
              <Field label="Total">{tokens(invocation.total_tokens)}</Field>
              <Field label="Reserved">
                {tokens(invocation.reserved_tokens)}
              </Field>
              <Field label="Charged">{tokens(invocation.charged_tokens)}</Field>
              <Field label="Usage">
                {invocation.usage_known ? "Known" : "Not reported"}
              </Field>
              {/* Costs carry no currency yet, so none is shown. */}
              <Field label="Cost">Unknown</Field>
            </dl>
          </section>

          {invocation.job_id && canManageTasks ? (
            <Button asChild variant="outline">
              <Link
                to={`/tasks?task_id=${encodeURIComponent(invocation.job_id)}`}
              >
                View job
              </Link>
            </Button>
          ) : null}

          <TechnicalDetails
            items={[
              { label: "Invocation ID", value: invocation.id },
              { label: "Connection ID", value: invocation.connection_id },
              { label: "Profile ID", value: invocation.profile_id },
              { label: "Profile version", value: invocation.profile_version },
              { label: "Job ID", value: invocation.job_id },
              { label: "Error code", value: invocation.error_code },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
