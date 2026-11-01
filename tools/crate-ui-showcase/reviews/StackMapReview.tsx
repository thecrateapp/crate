import { useState } from "react";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { StackMap } from "../../../app/ui/src/components/admin/StackMap";
import {
  createStackMapSample,
  type StackMapSample,
} from "./stack-map-fixtures";
import "./stack-map-review.css";

export function StackMapReview() {
  const [sample, setSample] = useState<StackMapSample>("observed");
  const [snapshot, setSnapshot] = useState(() => createStackMapSample());
  return (
    <main className="stack-map-review">
      <header className="stack-map-review__header">
        <div>
          <h1>Stack</h1>
          <p>
            Explore the services behind Crate and the infrastructure that
            observes them.
          </p>
        </div>
        <FormField kind="group" label="Snapshot sample">
          <SegmentedControl
            as="radio"
            label="Snapshot sample"
            value={sample}
            onValueChange={(value: StackMapSample) => {
              setSample(value);
              setSnapshot(createStackMapSample(value));
            }}
            items={[
              { value: "observed", label: "Observed" },
              { value: "degraded", label: "Degraded" },
              { value: "stale", label: "Stale" },
              { value: "unavailable", label: "Unavailable" },
            ]}
          />
        </FormField>
      </header>
      <p className="stack-map-review__notice">
        Interactive visual checkpoint · sample data · no server connection
      </p>
      <InstrumentPanel
        label={{ children: "Runtime map", tone: "accent" }}
        meta="One host · two stacks"
        summary="Host and stack topology"
      >
        <StackMap snapshot={snapshot} />
      </InstrumentPanel>
    </main>
  );
}
