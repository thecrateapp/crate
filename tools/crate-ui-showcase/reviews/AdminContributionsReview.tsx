import { useLayoutEffect, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";

import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";

import { Contributions } from "../../../app/ui/src/pages/Contributions";
import {
  completeContributionsRead,
  contributionsSampleState,
  setContributionsSample,
  subscribeContributionsSample,
} from "../../design-system-preview/admin-contributions-fixtures";

export function AdminContributionsReview() {
  const state = useSyncExternalStore(
    subscribeContributionsSample,
    contributionsSampleState,
    contributionsSampleState,
  );

  useLayoutEffect(() => {
    applyCrateIdentity();
    const disposeMotion = installFocusRingMotion();
    setContributionsSample("ready");
    return disposeMotion;
  }, []);

  return (
    <MemoryRouter initialEntries={["/contributions"]}>
      <main className="grid min-w-0 content-start gap-6 p-4 sm:p-6">
        <header
          data-admin-review-controls="contributions"
          className="grid min-w-0 gap-4 border-b border-border-quiet pb-5"
        >
          <div className="max-w-4xl space-y-2">
            <h2 className="m-0 font-display text-xl font-semibold text-text-primary">
              Contributions review
            </h2>
            <p className="m-0 text-sm text-text-muted">
              The real Admin review queue with local sample data. Refresh and
              album navigation stay inside this preview.
            </p>
          </div>
          <FormField kind="group" label="Sample state" className="min-w-0">
            <SegmentedControl
              as="radio"
              label="Sample state"
              className="min-w-0"
              value={state.sample}
              onValueChange={(value) =>
                setContributionsSample(
                  value as "ready" | "loading" | "empty" | "error",
                )
              }
              items={[
                { value: "ready", label: "Data" },
                { value: "loading", label: "Loading" },
                { value: "empty", label: "Empty" },
                { value: "error", label: "Error" },
              ]}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={!state.pending}
              onClick={completeContributionsRead}
            >
              Complete sample read
            </Button>
            <MonoLabel as="span" role="status" aria-live="polite">
              {state.pending
                ? "Sample read pending"
                : `${state.reads} sample reads`}
            </MonoLabel>
          </div>
        </header>
        <section aria-label="Contributions page" className="min-w-0">
          <Contributions key={state.sample} />
        </section>
        <Toaster {...toasterConfig} />
      </main>
    </MemoryRouter>
  );
}
