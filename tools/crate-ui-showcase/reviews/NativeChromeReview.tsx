import { useState } from "react";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { NativeMobileReview } from "./NativeMobileReview";
import { LinuxWindowTitlebarView } from "../../../app/listen-desktop/src/components/LinuxWindowTitlebarView";
import { TauriDevLogPanelView } from "../../../app/listen/src/components/dev/TauriDevLogPanelView";
import type { DevLogEntry } from "../../../app/listen/src/lib/dev-logs";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";

const SAMPLE_LOGS: DevLogEntry[] = [
  {
    id: 1,
    timestamp: 1792573200000,
    level: "info",
    scope: "output",
    message: "Output ready",
    detail: "Local diagnostic example",
  },
  {
    id: 2,
    timestamp: 1792573201000,
    level: "warn",
    scope: "recovery",
    message: "Waiting for output",
    detail:
      "A deliberately long diagnostic message wraps inside the panel without widening its container. ".repeat(
        8,
      ),
  },
  {
    id: 3,
    timestamp: 1792573202000,
    level: "error",
    scope: "audio",
    message: "Output unavailable",
  },
];

export function NativeChromeExample() {
  const [placement, setPlacement] = useState("right");
  const [lastAction, setLastAction] = useState("No window action");
  const [logs, setLogs] = useState(SAMPLE_LOGS);
  const [open, setOpen] = useState(true);
  return (
    <div className="grid min-w-0 gap-8">
      <FormField label="Window controls placement" kind="group">
        <SegmentedControl
          value={placement}
          onValueChange={setPlacement}
          as="radio"
          items={[
            { value: "right", label: "Right" },
            { value: "left", label: "Left" },
            { value: "split", label: "Split" },
          ]}
        />
      </FormField>
      <FormField label="Linux window chrome" kind="group">
        <div
          role="group"
          className="min-w-0 overflow-hidden rounded-panel border border-border-quiet"
        >
          <LinuxWindowTitlebarView
            layout={
              placement === "left"
                ? { left: ["close", "minimize", "maximize"], right: [] }
                : placement === "split"
                  ? { left: ["close"], right: ["minimize", "maximize"] }
                  : { left: [], right: ["minimize", "maximize", "close"] }
            }
            labels={{
              minimize: "Minimize window",
              maximize: "Maximize or restore window",
              close: "Close window",
            }}
            onAction={(control) => setLastAction(control)}
            onDrag={(event) => {
              if (event.buttons === 1)
                setLastAction(event.detail === 2 ? "maximize" : "drag");
            }}
          />
          <div className="grid min-h-28 content-center gap-2 p-6">
            <MonoLabel tone="accent">Listen desktop</MonoLabel>
            <p className="m-0 text-sm text-text-muted">
              Solid chrome, native window controls and a draggable title region.
            </p>
            <output
              className="font-mono text-xs text-text-muted"
              aria-live="polite"
            >
              {lastAction}
            </output>
          </div>
        </div>
      </FormField>
      <FormField label="Development diagnostics" kind="group">
        {(group) => (
          <div {...group} role="group">
            <TauriDevLogPanelView
              logs={logs}
              open={open}
              onOpenChange={setOpen}
              onClear={() => setLogs([])}
            />
          </div>
        )}
      </FormField>
    </div>
  );
}

export function NativeChromeReview({
  initialMobile = false,
}: {
  initialMobile?: boolean;
}) {
  const [mobile, setMobile] = useState(initialMobile);
  if (mobile) return <NativeMobileReview onClose={() => setMobile(false)} />;
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-5xl gap-8 p-4 sm:p-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Native shells"
          subtitle="Production views with local window callbacks and sample diagnostics. Controls preserve their native geometry; physical platform validation remains separate."
        />
        <NativeChromeExample />
        <FormField label="Capacitor geometry" kind="group">
          <div role="group" className="grid gap-4">
            <p className="m-0 text-sm text-text-muted">
              Open at a mobile viewport to inspect actual shell views with
              safe-area and keyboard fixtures.
            </p>
            <Button onClick={() => setMobile(true)}>
              Review Capacitor shell
            </Button>
          </div>
        </FormField>
      </main>
    </SettingsFixtureProvider>
  );
}
