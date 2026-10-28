import { useState } from "react";

import {
  QueueLanes,
  type QueueLaneTransition,
} from "../../app/ui/src/components/admin/QueueLanes";
import { DbHeavyGate } from "../../app/ui/src/components/admin/DbHeavyGate";
import {
  GovernorGauges,
  type GovernorSurface,
} from "../../app/ui/src/components/admin/GovernorGauges";
import {
  OpsPageHero,
  OpsPanel,
  OpsSnapshotStatus,
} from "../../app/ui/src/components/admin/ops-surfaces";
import {
  PlaybackDeliveryContent,
  type PlaybackDeliverySnapshot,
} from "../../app/ui/src/pages/PlaybackDelivery";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { Link } from "react-router";
import { AdminSelect } from "../../app/ui/src/components/ui/AdminSelect";
import { PageHeaderAction } from "../../app/ui/src/components/layout/PageHeader";
import {
  Ban,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";

const queue = {
  breakdown: {
    running: { fast: 1, default: 0, heavy: 1, maintenance: 1, playback: 1 },
    pending: { fast: 1, default: 2, heavy: 1, maintenance: 2, playback: 1 },
  },
  runningTasks: [
    { id: "task-enrich", type: "enrich_artist", pool: "fast" },
    { id: "task-analysis", type: "analyze_tracks", pool: "heavy" },
    { id: "task-repair", type: "health_check", pool: "maintenance" },
    { id: "task-playback", type: "warmup_stream_variants", pool: "playback" },
  ],
  pendingTasks: [
    { id: "task-sync", type: "library_sync", pool: "default" },
    { id: "task-match", type: "match_apply", pool: "default" },
    { id: "task-release", type: "new_release_scan", pool: "maintenance" },
  ],
  doneTasks: [
    {
      id: "task-done",
      type: "metadata_sync",
      pool: "default",
      status: "completed",
    },
  ],
};

const taskTransitions: QueueLaneTransition[] = [
  {
    id: "task-sync",
    type: "library_sync",
    pool: "default",
    status: "pending",
    created_at: "2026-10-22T10:28:00+02:00",
    updated_at: "2026-10-22T10:28:00+02:00",
    sequence: 1,
  },
  {
    id: "task-sync",
    type: "library_sync",
    pool: "default",
    status: "running",
    created_at: "2026-10-22T10:28:00+02:00",
    started_at: "2026-10-22T10:28:01+02:00",
    updated_at: "2026-10-22T10:28:01+02:00",
    sequence: 2,
  },
  {
    id: "task-sync",
    type: "library_sync",
    pool: "default",
    status: "completed",
    created_at: "2026-10-22T10:28:00+02:00",
    started_at: "2026-10-22T10:28:01+02:00",
    updated_at: "2026-10-22T10:28:08+02:00",
    sequence: 3,
  },
];

const governor: GovernorSurface = {
  available: true,
  stale: false,
  sampled_at: "2026-10-22T10:30:00+02:00",
  sampled_by: "crate-worker",
  enabled: true,
  allowed: true,
  defer_seconds: 300,
  gauges: [
    {
      id: "load_ratio",
      label: "Load ratio",
      value: 0.48,
      unit: "",
      limit: 0.85,
      scale: 1.2,
      over: false,
    },
    {
      id: "iowait_percent",
      label: "I/O wait",
      value: 5.2,
      unit: "%",
      limit: 25,
      scale: 40,
      over: false,
    },
    {
      id: "swap_used_percent",
      label: "Swap used",
      value: 18,
      unit: "%",
      limit: 30,
      scale: 60,
      over: false,
    },
    {
      id: "active_users",
      label: "Listeners",
      value: 5,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
    {
      id: "active_streams",
      label: "Streams",
      value: 3,
      unit: "",
      limit: 10,
      scale: 14,
      over: false,
    },
  ],
  window: { enabled: true, start: "02:00", end: "07:00", in_window: false },
};

const playback: PlaybackDeliverySnapshot = {
  stats: {
    lossless_tracks: 1240,
    hires_tracks: 182,
    variants: 980,
    ready: 914,
    pending: 18,
    pending_active: 12,
    pending_unassigned: 6,
    pending_stale: 0,
    running: 3,
    failed: 2,
    missing: 326,
    ready_tracks: 1112,
    cached_bytes: 42_900_000_000,
    estimated_saved_bytes: 18_400_000_000,
    coverage_percent: 89.7,
    avg_prepare_seconds: 1.8,
  },
  runtime: { active: 3, limit: 6 },
  recent_variants: [
    {
      id: "variant-1",
      track_id: 101,
      preset: "streaming",
      status: "ready",
      delivery_format: "AAC",
      delivery_bitrate: 256,
      source_format: "FLAC",
      source_size: 48_000_000,
      bytes: 9_200_000,
      title: "The Universal",
      artist: "Blur",
      album: "The Great Escape",
      updated_at: "2026-10-22T10:29:00+02:00",
    },
    {
      id: "variant-2",
      track_id: 214,
      preset: "streaming",
      status: "pending",
      delivery_format: "AAC",
      delivery_bitrate: 256,
      source_format: "ALAC",
      source_size: 52_000_000,
      bytes: null,
      title: "Teardrop",
      artist: "Massive Attack",
      album: "Mezzanine",
      updated_at: "2026-10-22T10:26:00+02:00",
    },
  ],
};

const taskViews = [
  { value: "active", label: "Active & queued" },
  { value: "attention", label: "Needs attention" },
  { value: "history", label: "History" },
] as const;

export function AdminTaskPlaybackReview() {
  const [page, setPage] = useState("tasks");
  const [taskView, setTaskView] = useState("active");
  const [taskFamily, setTaskFamily] = useState("all");
  const [taskConcurrency, setTaskConcurrency] = useState(15);

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 p-6">
      <Tabs value={page} onValueChange={setPage} className="gap-6">
        <TabsList aria-label="Admin task review pages">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="playback">Playback Delivery</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="mt-0 space-y-6">
          <OpsPageHero
            title="Tasks"
            description="Background orchestration for enrichment, analysis, sync, repair and acquisition jobs across the whole stack."
            actions={
              <PageHeaderAction label="Refresh" onClick={() => undefined}>
                <RefreshCw aria-hidden="true" />
              </PageHeaderAction>
            }
          >
            <OpsSnapshotStatus
              snapshot={{ stale: false, built_at: "2026-10-22T10:30:00+02:00" }}
              streamStatus="live"
            />
          </OpsPageHero>

          <OpsPanel
            title="Worker runtime"
            titleTone="accent"
            description="Queue lanes, concurrency controls and resource pressure for background work."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <InfoBadge active>dramatiq</InfoBadge>
                <InfoBadge>0 running</InfoBadge>
                <InfoBadge>0 pending</InfoBadge>
                <InfoBadge>{taskConcurrency} concurrent tasks</InfoBadge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-11 items-center gap-1 rounded-md border border-border-quiet bg-surface-control px-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    aria-label="Decrease worker concurrency"
                    onClick={() =>
                      setTaskConcurrency((value) => Math.max(1, value - 1))
                    }
                  >
                    <Minus size={12} aria-hidden="true" />
                  </Button>
                  <span className="w-8 text-center text-sm font-medium tabular-nums text-text-secondary">
                    {taskConcurrency}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    aria-label="Increase worker concurrency"
                    onClick={() =>
                      setTaskConcurrency((value) => Math.min(64, value + 1))
                    }
                  >
                    <Plus size={12} aria-hidden="true" />
                  </Button>
                </div>
                <PageHeaderAction asChild label="Worker logs">
                  <Link to="/logs">
                    <ScrollText aria-hidden="true" />
                  </Link>
                </PageHeaderAction>
                <PageHeaderAction label="Cancel all tasks">
                  <Ban aria-hidden="true" />
                </PageHeaderAction>
                <PageHeaderAction
                  label="Restart crate-worker"
                  tooltip="Restarts crate-worker: default and fast queues plus its service loop."
                >
                  <RotateCcw aria-hidden="true" />
                </PageHeaderAction>
              </div>
            </div>
            <QueueLanes
              breakdown={queue.breakdown}
              runningTasks={queue.runningTasks}
              pendingTasks={queue.pendingTasks}
              doneTasks={queue.doneTasks}
              transitions={taskTransitions}
              taskTypeCount={184}
            />
            <div className="mt-4 flex flex-col gap-10">
              <GovernorGauges surface={governor} />
              <DbHeavyGate gate={{ active: 0, pending: 0, blocking: false }} />
            </div>
          </OpsPanel>

          <OpsPanel
            title="Task desk"
            titleTone="accent"
            description="Review live work, resolve failures and inspect recent task results."
          >
            <Tabs
              value={taskView}
              onValueChange={setTaskView}
              className="gap-5"
            >
              <TabsList aria-label="Task views" className="w-full max-w-full">
                {taskViews.map((view) => (
                  <TabsTrigger key={view.value} value={view.value}>
                    {view.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.8fr)_minmax(200px,1fr)]">
                <div className="relative min-w-0 md:col-span-2 lg:col-span-1">
                  <Search
                    size={14}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
                  />
                  <Input
                    aria-label="Search tasks"
                    placeholder="Search labels, ids or params..."
                    className="pl-9"
                  />
                </div>
                <AdminSelect
                  ariaLabel="Task family"
                  value={taskFamily}
                  onChange={setTaskFamily}
                  options={[
                    { value: "all", label: "All families" },
                    { value: "repair", label: "Repair" },
                    { value: "acquisition", label: "Acquisition" },
                    { value: "analysis", label: "Analysis" },
                    { value: "sync", label: "Sync" },
                    { value: "enrichment", label: "Enrichment" },
                    { value: "other", label: "Other" },
                  ]}
                  placeholder="All families"
                  allowClear={false}
                  triggerClassName="w-full min-w-0 max-w-none"
                />
                <AdminSelect
                  value=""
                  onChange={() => undefined}
                  options={[
                    { value: "quality_check", label: "Quality check" },
                    { value: "analyze_tracks", label: "Analyze tracks" },
                    { value: "metadata_sync", label: "Metadata sync" },
                  ]}
                  placeholder="All task types"
                  searchable
                  triggerClassName="w-full min-w-0 max-w-none"
                />
              </div>
              <TabsContent
                value="active"
                className="mt-0 divide-y divide-border-quiet"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      Artist metadata refresh
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      The National · 4 of 18 artists
                    </div>
                  </div>
                  <InfoBadge tone="success">Running</InfoBadge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      Playback variant warmup
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      8 tracks queued · playback
                    </div>
                  </div>
                  <InfoBadge>Queued</InfoBadge>
                </div>
              </TabsContent>
              <TabsContent value="attention" className="mt-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-quiet py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      Album artwork lookup
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      2 items need review
                    </div>
                  </div>
                  <InfoBadge tone="warning">Failed</InfoBadge>
                </div>
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-quiet py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary">
                      Library synchronization
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      12 artists · completed 4 minutes ago
                    </div>
                  </div>
                  <InfoBadge tone="success">Completed</InfoBadge>
                </div>
              </TabsContent>
            </Tabs>
          </OpsPanel>
        </TabsContent>
        <TabsContent value="playback" className="mt-0">
          <PlaybackDeliveryContent
            delivery={playback}
            loading={false}
            error={null}
            onRefresh={() => undefined}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
