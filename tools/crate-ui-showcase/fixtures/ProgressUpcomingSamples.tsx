import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { UpcomingDateStamp } from "@crate/ui/domain/shows/UpcomingDateStamp";
import { UpcomingEventRow } from "@crate/ui/domain/shows/UpcomingEventRow";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { FormField } from "@crate/ui/primitives/FormField";
import { Meter } from "@crate/ui/primitives/Meter";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { Progress } from "@crate/ui/shadcn/progress";
import { Eye, MoreHorizontal } from "@crate/ui/icons";

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(control) => (
        <div {...control} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}

export function MeterStates() {
  return (
    <div className="grid min-w-0 gap-6">
      <Sample label="Known, empty and unavailable quantities">
        <Meter
          label="Storage"
          value={640}
          max={1024}
          limit={900}
          valueText="640 MB / 1 GB"
        />
        <Meter label="Known zero" value={0} max={100} valueText="0 / 100" />
        <Meter
          label="Missing measurement"
          value={null}
          max={100}
          valueText="Unknown"
        />
        <Meter label="No capacity" value={0} max={0} valueText="0 / 0" />
        <Meter label="Over limit" value={5} max={4} over valueText="5 / 4" />
      </Sample>
      <Sample label="Localized narrow neighbors">
        <div className="grid min-w-0 grid-cols-2 gap-6">
          <Meter label="Tracks" value={34} max={50} valueText="34 / 50" />
          <Meter
            label="Biltegiratzea"
            value={640}
            max={1024}
            valueText="640 MB / 1 GB"
          />
        </div>
      </Sample>
    </div>
  );
}

export function HairlineProgressStates() {
  return (
    <Sample label="Ratio progress and unknown total">
      <ProgressHairline label="Not started" value={0} valueText="0 of 4" />
      <ProgressHairline label="Half complete" value={0.5} valueText="2 of 4" />
      <ProgressHairline label="Complete" value={1} valueText="4 of 4" />
      <ProgressHairline
        label="Clamped progress"
        value={1.5}
        valueText="Complete"
      />
      <ProgressHairline
        label="Waiting for server"
        valueText="Total not known"
      />
    </Sample>
  );
}

export function RadixProgressStates() {
  return (
    <Sample label="Radix numeric progress">
      <Progress aria-label="Radix not started" value={0} />
      <Progress aria-label="Radix half complete" value={50} />
      <Progress aria-label="Radix complete" value={100} />
      <Progress aria-label="Radix custom maximum" value={50} max={200} />
      <Progress aria-label="Radix unknown total" value={null} />
    </Sample>
  );
}

export function DateStampStates() {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Sample label="English leap day">
        <UpcomingDateStamp date="2028-02-29" locale="en-US" />
      </Sample>
      <Sample label="Spanish local calendar">
        <UpcomingDateStamp date="2030-01-20" locale="es" />
      </Sample>
      <Sample label="Invalid calendar date">
        <UpcomingDateStamp date="2030-02-31" locale="en" />
      </Sample>
      <Sample label="Missing date">
        <UpcomingDateStamp date="" locale="en" />
      </Sample>
    </div>
  );
}

export function UpcomingRowStates() {
  const [expanded, setExpanded] = useState(false);
  const [event, setEvent] = useState("No action requested");
  const artwork = (
    <MediaCover
      alt="Example event artwork"
      fallback="NE"
      className="size-22 shrink-0"
    />
  );
  const details = (
    <>
      <span className="block wrap-anywhere text-sm text-text-primary">
        Nocturnal Ensemble
      </span>
      <MonoLabel as="span">The Forum · London</MonoLabel>
    </>
  );
  return (
    <MemoryRouter>
      <div className="grid min-w-0 gap-6">
        <Sample label="Expandable event with independent actions">
          <UpcomingEventRow
            artwork={artwork}
            details={details}
            date={<UpcomingDateStamp date="2030-01-20" locale="en-US" />}
            actions={
              <ActionGroup label="Event actions">
                <ActionButton
                  label="Preview event"
                  onClick={() => setEvent("Preview requested")}
                >
                  <Eye aria-hidden="true" />
                </ActionButton>
                <ActionButton
                  label="More event actions"
                  onClick={() => setEvent("More actions requested")}
                >
                  <MoreHorizontal aria-hidden="true" />
                </ActionButton>
              </ActionGroup>
            }
            onToggle={() => setExpanded((value) => !value)}
            expanded={expanded}
          />
          {expanded ? (
            <p className="m-0 text-sm text-text-muted">
              Event details are expanded.
            </p>
          ) : null}
          <output aria-label="Upcoming action result" aria-live="polite">
            {event}
          </output>
        </Sample>
        <Sample label="Native destination with no date or actions">
          <UpcomingEventRow
            artwork={artwork}
            details={
              <span className="block wrap-anywhere text-sm">
                A release with no confirmed date
              </span>
            }
            date={null}
            actions={null}
            href="/upcoming/example"
            openLabel="Open example release"
          />
        </Sample>
        <Sample label="Read-only identity">
          <UpcomingEventRow
            artwork={artwork}
            details={details}
            date={<UpcomingDateStamp date="2030-01-20" locale="en" />}
            actions={null}
          />
        </Sample>
      </div>
    </MemoryRouter>
  );
}
