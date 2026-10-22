import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  OpsPageHero,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  OpsStatTile,
  OpsSurface,
} from "../../../app/ui/src/components/admin/ops-surfaces";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

const meta = {
  title: "Reviews/Admin/A2 Operational surfaces",
  component: OpsSurface,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof OpsSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SolidSurface: Story = {
  render: () => (
    <main className="mx-auto grid min-h-screen max-w-7xl content-start gap-6 p-6">
      <OpsPageHero
        title="System Health"
        description="Page headers follow Dashboard; operational cards keep solid surfaces."
      >
        <InfoBadge>Connected</InfoBadge>
      </OpsPageHero>
      <div className="grid gap-4 md:grid-cols-3">
        <OpsStatTile label="Health score" value="92" caption="Current sample" />
        <OpsStatTile label="Queue depth" value="7" caption="Pending tasks" />
        <OpsStatTile
          label="Worker slots"
          value="2 / 5"
          caption="Active / limit"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <OpsSurface as="article" aria-label="Resource card" className="p-4">
          <MonoLabel as="div">Resource card</MonoLabel>
          <p className="mt-3 text-sm text-text-muted">
            Resource and chart cards keep their measurements on an opaque raised
            surface.
          </p>
        </OpsSurface>
        <OpsSurface as="article" aria-label="Service card" className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MonoLabel as="div">Service card</MonoLabel>
            <InfoBadge>Running</InfoBadge>
          </div>
          <p className="mt-3 text-sm text-text-muted">
            Stack service actions and state remain inside the same quiet border.
          </p>
        </OpsSurface>
      </div>
    </main>
  ),
};

export const FreshnessAndRecovery: Story = {
  render: () => (
    <main className="mx-auto grid min-h-screen max-w-7xl content-start gap-6 p-6">
      <OpsPageHero
        title="Task orchestration"
        description="Snapshot freshness and stream health stay distinct."
      >
        <OpsSnapshotStatus
          snapshot={{ stale: false, built_at: "2026-10-22T09:30:00Z" }}
          streamStatus="live"
        />
      </OpsPageHero>
      <OpsSurface
        as="article"
        aria-label="Stale recovery sample"
        className="p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <OpsSnapshotStatus
            snapshot={{ stale: true, built_at: "2026-10-22T08:30:00Z" }}
            streamStatus="reconnecting"
          />
        </div>
        <p className="mt-4 text-sm text-text-muted">
          A stream reconnect does not erase the last useful snapshot.
        </p>
        <OpsRefreshNotice
          message="Could not refresh task orchestration. Showing the last successful snapshot."
          onRetry={() => undefined}
          className="mt-4"
        />
      </OpsSurface>
    </main>
  ),
};
