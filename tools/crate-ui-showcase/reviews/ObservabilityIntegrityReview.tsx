import { useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { SystemHealth } from "../../../app/ui/src/pages/SystemHealth";
import {
  setSystemSample,
  subscribeSystemSample,
  systemSampleState,
} from "../../design-system-preview/admin-system-health-fixtures";

export function ObservabilityIntegrityReview() {
  const state = useSyncExternalStore(subscribeSystemSample, systemSampleState);
  return (
    <MemoryRouter>
      <main className="grid min-w-0 gap-6 p-4 sm:p-6">
        <header className="grid gap-4 border-b border-border-quiet pb-6">
          <p className="text-sm text-text-muted">
            PR1A · Collection integrity. Actual Admin page with local fixtures;
            no backend requests.
          </p>
          <FormField kind="group" label="Metrics sample">
            <SegmentedControl
              as="radio"
              label="Metrics sample"
              value={state.sample}
              onValueChange={setSystemSample}
              items={[
                { value: "ready", label: "Observed" },
                { value: "unavailable", label: "Redis unavailable" },
                { value: "empty", label: "Empty" },
                { value: "partial", label: "Partial" },
                { value: "stale", label: "Stale" },
                { value: "legacy", label: "Legacy" },
              ]}
            />
          </FormField>
        </header>
        <SystemHealth />
      </main>
    </MemoryRouter>
  );
}
