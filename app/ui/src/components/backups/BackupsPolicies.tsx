import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { cn } from "@crate/ui/lib/cn";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { AdminSelect } from "@/components/ui/AdminSelect";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { api } from "@/lib/api";
import {
  BACKUPS_API,
  TIERS,
  formatBackupBytes,
  keptCopies,
  policyLine,
  reachText,
  type BackupDestinationHealth,
  type BackupLocalRetention,
  type BackupOverview,
  type BackupPolicy,
  type BackupTier,
  type Compression,
  type ScheduleKind,
} from "@/lib/backups";

import { HealthDot, KindMark, Section } from "./backup-ui";
import { displayHealth } from "./BackupsOverview";
import { RetentionStrip } from "./RetentionStrip";

const TH = "font-mono text-label uppercase tracking-caps";
const CELL_MONO = "font-mono text-sm text-text-secondary";
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TIER_LABEL: Record<BackupTier, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const NEW_POLICY = "new";

export interface PolicyDraft {
  name: string;
  enabled: boolean;
  schedule_kind: ScheduleKind;
  daily_at: string;
  interval_hours: string;
  window: boolean;
  window_start: string;
  window_end: string;
  keep_daily: string;
  keep_weekly: string;
  keep_monthly: string;
  compression: Compression;
  verify_every_days: string;
  verify_read_percent: string;
  drill_every_days: string;
  drill_source: string;
  run_before_upgrade: boolean;
  destinations: Record<string, BackupTier[]>;
}

function draftOf(policy: BackupPolicy | null): PolicyDraft {
  if (!policy)
    return {
      name: "",
      enabled: true,
      schedule_kind: "daily",
      daily_at: "03:30",
      interval_hours: "6",
      window: false,
      window_start: "02:00",
      window_end: "06:00",
      keep_daily: "7",
      keep_weekly: "4",
      keep_monthly: "3",
      compression: "auto",
      verify_every_days: "7",
      verify_read_percent: "5",
      drill_every_days: "30",
      drill_source: "rotate",
      run_before_upgrade: false,
      destinations: {},
    };
  return {
    name: policy.name,
    enabled: policy.enabled,
    schedule_kind: policy.schedule_kind,
    daily_at: policy.daily_at ?? "03:30",
    interval_hours: String(policy.interval_hours ?? 6),
    window: Boolean(policy.window_start && policy.window_end),
    window_start: policy.window_start ?? "02:00",
    window_end: policy.window_end ?? "06:00",
    keep_daily: String(policy.keep_daily),
    keep_weekly: String(policy.keep_weekly),
    keep_monthly: String(policy.keep_monthly),
    compression: policy.compression,
    verify_every_days: String(policy.verify_every_days),
    verify_read_percent: String(policy.verify_read_percent),
    drill_every_days: String(policy.drill_every_days),
    drill_source: policy.drill_destination_id ?? "rotate",
    run_before_upgrade: policy.run_before_upgrade,
    destinations: { ...policy.destinations },
  };
}

function whole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export type PolicyErrors = Partial<Record<keyof PolicyDraft | "keep", string>>;

/** The API's rules, checked before sending so mistakes show at their field. */
export function validatePolicy(draft: PolicyDraft): PolicyErrors {
  const errors: PolicyErrors = {};
  const name = draft.name.trim();
  if (!name || name.length > 80)
    errors.name = "The policy needs a name of 1 to 80 characters.";
  if (draft.schedule_kind === "daily" && !HHMM.test(draft.daily_at.trim()))
    errors.daily_at = "Use a time of day as HH:MM.";
  if (draft.schedule_kind === "hours") {
    const hours = whole(draft.interval_hours);
    if (hours == null || hours < 1 || hours > 168)
      errors.interval_hours = "Every 1 to 168 hours.";
  }
  if (draft.window && draft.schedule_kind !== "manual")
    if (
      !HHMM.test(draft.window_start.trim()) ||
      !HHMM.test(draft.window_end.trim())
    )
      errors.window_start = "The window needs a start and an end as HH:MM.";
  const counts = [draft.keep_daily, draft.keep_weekly, draft.keep_monthly].map(
    whole,
  );
  if (counts.some((count) => count == null || count > 1000))
    errors.keep = "Each count is a whole number from 0 to 1000.";
  else if (counts.every((count) => count === 0))
    errors.keep = "Keep at least one copy.";
  const verify = whole(draft.verify_every_days);
  const percent = whole(draft.verify_read_percent);
  if (
    verify == null ||
    verify > 365 ||
    percent == null ||
    percent < 1 ||
    percent > 100
  )
    errors.verify_every_days = "Every 0 to 365 days, reading 1 to 100%.";
  const drill = whole(draft.drill_every_days);
  if (drill == null || drill > 365)
    errors.drill_every_days = "Every 0 to 365 days.";
  return errors;
}

export function policyPayload(draft: PolicyDraft) {
  const manual = draft.schedule_kind === "manual";
  const windowed = draft.window && !manual;
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    schedule_kind: draft.schedule_kind,
    daily_at: draft.schedule_kind === "daily" ? draft.daily_at.trim() : null,
    interval_hours:
      draft.schedule_kind === "hours" ? Number(draft.interval_hours) : null,
    window_start: windowed ? draft.window_start.trim() : null,
    window_end: windowed ? draft.window_end.trim() : null,
    keep_daily: Number(draft.keep_daily),
    keep_weekly: Number(draft.keep_weekly),
    keep_monthly: Number(draft.keep_monthly),
    compression: draft.compression,
    verify_every_days: Number(draft.verify_every_days),
    verify_read_percent: Number(draft.verify_read_percent),
    drill_every_days: Number(draft.drill_every_days),
    drill_destination_id:
      draft.drill_source === "rotate" ? null : draft.drill_source,
    run_before_upgrade: draft.run_before_upgrade,
    destinations: Object.fromEntries(
      Object.entries(draft.destinations).filter(([, tiers]) => tiers.length),
    ),
  };
}

/** The Settings field-row recipe: 200 px caption column, hairline between rows. */
function Row({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border-quiet-subtle py-4 last:border-b-0">
      <FormField
        kind="group"
        label={label}
        hint={hint}
        error={error}
        className="gap-x-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-center [&>[data-slot=form-field-error]]:md:col-start-2 [&>[data-slot=form-field-hint]]:md:col-start-2"
      >
        {(field) => (
          <div
            id={field.id}
            role="group"
            aria-labelledby={field["aria-labelledby"]}
            aria-describedby={field["aria-describedby"]}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {children}
          </div>
        )}
      </FormField>
    </div>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="text-xs text-text-muted">{children}</span>;
}

function TimeInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <Input
      inputMode="numeric"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder="HH:MM"
      className="w-24"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  invalid?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="w-20"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function usable(destination: BackupDestinationHealth) {
  return destination.enabled && Boolean(destination.repository_initialized_at);
}

function TierMatrix({
  destinations,
  draft,
  dumpBytes,
  today,
  onChange,
}: {
  destinations: readonly BackupDestinationHealth[];
  draft: PolicyDraft;
  dumpBytes: number | null;
  today: Date;
  onChange: (tiers: Record<string, BackupTier[]>) => void;
}) {
  const counts = {
    keep_daily: whole(draft.keep_daily) ?? 0,
    keep_weekly: whole(draft.keep_weekly) ?? 0,
    keep_monthly: whole(draft.keep_monthly) ?? 0,
  };
  function toggle(id: string, tier: BackupTier, on: boolean) {
    const current = draft.destinations[id] ?? [];
    const next = on ? [...current, tier] : current.filter((t) => t !== tier);
    onChange({
      ...draft.destinations,
      [id]: TIERS.filter((t) => next.includes(t)),
    });
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Destination</TableHead>
            {TIERS.map((tier) => (
              <TableHead key={tier} className={cn(TH, "text-center")}>
                {TIER_LABEL[tier]}
              </TableHead>
            ))}
            <TableHead className={cn(TH, "text-right")}>Copies kept</TableHead>
            <TableHead className={cn(TH, "text-right")}>Storage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {destinations.map((d) => {
            const available = usable(d);
            const health = displayHealth(d);
            const tiers = draft.destinations[d.id] ?? [];
            const copies = keptCopies(counts, tiers, today);
            return (
              <TableRow key={d.id} className={cn(!available && "opacity-60")}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <KindMark kind={d.kind} />
                    <span className="text-sm text-text-primary">{d.name}</span>
                    {!available || health === "failing" ? (
                      <HealthDot health={health} />
                    ) : null}
                  </div>
                </TableCell>
                {TIERS.map((tier) => (
                  <TableCell key={tier} className="text-center">
                    <Checkbox
                      checked={tiers.includes(tier)}
                      disabled={!available}
                      onCheckedChange={(checked) =>
                        toggle(d.id, tier, checked === true)
                      }
                      aria-label={`${TIER_LABEL[tier]} copies to ${d.name}`}
                    />
                  </TableCell>
                ))}
                {!available ? (
                  <TableCell colSpan={2} className="text-right">
                    <span className="text-sm text-text-muted">
                      {d.repository_initialized_at
                        ? "Destination disabled"
                        : "Test the connection first"}
                    </span>
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right">
                      <span className={CELL_MONO}>
                        {tiers.length ? `Up to ${copies}` : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={CELL_MONO}>
                        {tiers.length && dumpBytes
                          ? `About ${formatBackupBytes(copies * dumpBytes)}`
                          : "—"}
                      </span>
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Local dumps keep their own counts, apart from the off-site policies (BG1-5). */
function LocalRetention({
  retention,
  onSaved,
}: {
  retention: BackupLocalRetention;
  onSaved: () => void;
}) {
  const [values, setValues] = useState({
    keep_daily: String(retention.keep_daily),
    keep_weekly: String(retention.keep_weekly),
    keep_monthly: String(retention.keep_monthly),
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValues({
      keep_daily: String(retention.keep_daily),
      keep_weekly: String(retention.keep_weekly),
      keep_monthly: String(retention.keep_monthly),
    });
  }, [retention.keep_daily, retention.keep_weekly, retention.keep_monthly]);
  const numbers = Object.values(values).map(whole);
  const error = numbers.some((n) => n == null || n > 1000)
    ? "Each count is a whole number."
    : numbers.every((n) => n === 0)
      ? "Keep at least one dump."
      : null;
  const changed =
    whole(values.keep_daily) !== retention.keep_daily ||
    whole(values.keep_weekly) !== retention.keep_weekly ||
    whole(values.keep_monthly) !== retention.keep_monthly;
  async function save() {
    setBusy(true);
    try {
      await api(`${BACKUPS_API}/local-retention`, "PUT", {
        keep_daily: Number(values.keep_daily),
        keep_weekly: Number(values.keep_weekly),
        keep_monthly: Number(values.keep_monthly),
      });
      toast.success("Local retention saved");
      onSaved();
    } catch (err) {
      toast.error(apiErrorText(err, "The local retention could not be saved"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Local dumps"
      description="Dumps kept on the backup volume itself, before any copy. Their counts are separate from the policies."
      action={
        <Button
          type="button"
          variant="outline"
          disabled={!changed || Boolean(error) || busy}
          aria-busy={busy || undefined}
          onClick={() => void save()}
        >
          Save local retention
        </Button>
      }
    >
      <div>
        <Row label="Keep" error={error}>
          {(["daily", "weekly", "monthly"] as const).map((tier) => (
            <div key={tier} className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">
                {TIER_LABEL[tier]}
              </span>
              <NumberInput
                label={`Local dumps kept ${tier}`}
                value={values[`keep_${tier}`]}
                invalid={Boolean(error)}
                onChange={(value) =>
                  setValues({ ...values, [`keep_${tier}`]: value })
                }
              />
            </div>
          ))}
        </Row>
      </div>
    </Section>
  );
}

export function BackupsPolicies({
  policies,
  overview,
  selected,
  onSelect,
  onChanged,
  now = Date.now(),
}: {
  policies: readonly BackupPolicy[];
  overview: BackupOverview;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  now?: number;
}) {
  const current =
    selected === NEW_POLICY
      ? null
      : (policies.find((p) => p.id === selected) ?? policies[0] ?? null);
  const creating = selected === NEW_POLICY || (!current && !policies.length);
  const key = creating ? NEW_POLICY : (current?.id ?? "");
  const [draft, setDraft] = useState<PolicyDraft>(() =>
    draftOf(creating ? null : current),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setDraft(draftOf(creating ? null : current));
    setShowErrors(false);
  }, [key, current?.updated_at]);

  const errors = validatePolicy(draft);
  const shown: PolicyErrors = showErrors ? errors : {};
  const dumpBytes = overview.stats.latest_dump?.bytes ?? null;
  const counts = {
    keep_daily: whole(draft.keep_daily) ?? 0,
    keep_weekly: whole(draft.keep_weekly) ?? 0,
    keep_monthly: whole(draft.keep_monthly) ?? 0,
  };
  const kept = keptCopies(counts, TIERS, new Date(now));
  const local = overview.local_retention;
  const tiered = overview.destinations.filter(
    (d) => (draft.destinations[d.id] ?? []).length,
  );
  const meanRepo =
    tiered.reduce((sum, d) => sum + (d.repository_bytes ?? 0), 0) /
    (tiered.length || 1);
  const readPercent = whole(draft.verify_read_percent) ?? 0;
  const drillOptions = [
    { value: "rotate", label: "Each destination in turn" },
    ...overview.destinations
      .filter((d) => usable(d) && (draft.destinations[d.id] ?? []).length)
      .map((d) => ({ value: d.id, label: d.name })),
  ];
  // A source that left the policy or became unusable falls back to rotation.
  const drillSource = drillOptions.some((o) => o.value === draft.drill_source)
    ? draft.drill_source
    : "rotate";
  const set = <K extends keyof PolicyDraft>(field: K, value: PolicyDraft[K]) =>
    setDraft((previous) => ({ ...previous, [field]: value }));

  async function save() {
    setShowErrors(true);
    if (Object.keys(errors).length) {
      toast.error("Check the highlighted fields");
      return;
    }
    setBusy(true);
    try {
      const body = policyPayload(draft);
      const saved = creating
        ? await api<BackupPolicy>(`${BACKUPS_API}/policies`, "POST", body)
        : await api<BackupPolicy>(
            `${BACKUPS_API}/policies/${current!.id}`,
            "PATCH",
            body,
          );
      toast.success(creating ? "Policy created" : "Policy saved");
      onSelect(saved.id);
      onChanged();
    } catch (error) {
      toast.error(apiErrorText(error, "The policy could not be saved"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    try {
      await api(`${BACKUPS_API}/policies/${current.id}`, "DELETE");
      toast.success("Policy deleted");
      setConfirmDelete(false);
      onSelect(null);
      onChanged();
    } catch (error) {
      toast.error(apiErrorText(error, "The policy could not be deleted"));
    } finally {
      setBusy(false);
    }
  }

  const title = creating ? "New policy" : (current?.name ?? "Policy");
  return (
    <>
      <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Section title="Policies">
          {policies.length ? (
            <HairlineList as="ul" label="Backup policies">
              {policies.map((policy) => (
                <HairlineRow
                  key={policy.id}
                  asChild
                  active={!creating && policy.id === current?.id}
                  muted={!policy.enabled}
                  trailing={
                    <InfoBadge tone={policy.enabled ? "accent" : "neutral"}>
                      {policy.enabled ? "On" : "Off"}
                    </InfoBadge>
                  }
                >
                  <button
                    type="button"
                    aria-current={
                      !creating && policy.id === current?.id
                        ? "true"
                        : undefined
                    }
                    onClick={() => onSelect(policy.id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-text-primary">
                        {policy.name}
                      </span>
                      <span className="block font-mono text-label text-text-subtle">
                        {policyLine(policy)}
                      </span>
                    </span>
                  </button>
                </HairlineRow>
              ))}
            </HairlineList>
          ) : (
            <p className="text-sm text-text-muted">
              No off-site policy yet. Local dumps still run on their own.
            </p>
          )}
        </Section>

        <div className="min-w-0 space-y-8">
          <Section
            title={title}
            description="Each run makes one database dump, prunes the local dumps, then sends the dump to every destination whose tier it matches."
            action={
              <div className="flex flex-wrap gap-2">
                {!creating && current ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete policy
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDraft(draftOf(creating ? null : current));
                    setShowErrors(false);
                    if (creating && policies.length) onSelect(null);
                  }}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void save()}
                >
                  {creating ? "Create policy" : "Save policy"}
                </Button>
              </div>
            }
          >
            <div>
              <Row label="Name" error={shown.name}>
                <Input
                  aria-label="Policy name"
                  aria-invalid={Boolean(shown.name) || undefined}
                  className="max-w-sm"
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                />
              </Row>
              <Row label="Enabled">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => set("enabled", enabled)}
                  aria-label="Policy enabled"
                />
                <span className="text-sm text-text-secondary">
                  {draft.schedule_kind === "manual"
                    ? "Runs when started by hand or before an upgrade"
                    : "Runs on its schedule"}
                </span>
              </Row>
              <Row
                label="Schedule"
                hint="Times are in the server's time zone."
                error={shown.daily_at ?? shown.interval_hours}
              >
                <SegmentedControl<ScheduleKind>
                  as="radio"
                  label="Schedule"
                  value={draft.schedule_kind}
                  onValueChange={(value) => set("schedule_kind", value)}
                  items={[
                    { value: "hours", label: "Every N hours" },
                    { value: "daily", label: "Daily at" },
                    { value: "manual", label: "Manual" },
                  ]}
                />
                {draft.schedule_kind === "daily" ? (
                  <TimeInput
                    label="Daily time, HH:MM"
                    value={draft.daily_at}
                    invalid={Boolean(shown.daily_at)}
                    onChange={(value) => set("daily_at", value)}
                  />
                ) : null}
                {draft.schedule_kind === "hours" ? (
                  <>
                    <NumberInput
                      label="Every N hours"
                      min={1}
                      max={168}
                      value={draft.interval_hours}
                      invalid={Boolean(shown.interval_hours)}
                      onChange={(value) => set("interval_hours", value)}
                    />
                    <Unit>hours</Unit>
                  </>
                ) : null}
              </Row>
              {draft.schedule_kind === "manual" ? (
                <Row
                  label="Before upgrades"
                  hint="The deploy runs these policies with make backup-before-upgrade and waits for them."
                >
                  <Switch
                    checked={draft.run_before_upgrade}
                    onCheckedChange={(on) => set("run_before_upgrade", on)}
                    aria-label="Run before upgrades"
                  />
                  <span className="text-sm text-text-secondary">
                    Run before upgrades
                  </span>
                </Row>
              ) : (
                <Row
                  label="Window"
                  hint="Uploads start only inside the window and wait for the load governor. A copy already uploading at the end finishes."
                  error={shown.window_start}
                >
                  <Switch
                    checked={draft.window}
                    onCheckedChange={(on) => set("window", on)}
                    aria-label="Only start inside a window"
                  />
                  <span className="text-sm text-text-secondary">From</span>
                  <TimeInput
                    label="Window start, HH:MM"
                    value={draft.window_start}
                    invalid={Boolean(shown.window_start)}
                    onChange={(value) => set("window_start", value)}
                  />
                  <span className="text-sm text-text-secondary">to</span>
                  <TimeInput
                    label="Window end, HH:MM"
                    value={draft.window_end}
                    invalid={Boolean(shown.window_start)}
                    onChange={(value) => set("window_end", value)}
                  />
                </Row>
              )}
              <Row label="Retention" error={shown.keep}>
                <div className="w-full space-y-4">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    {(["daily", "weekly", "monthly"] as const).map((tier) => (
                      <div key={tier} className="flex items-center gap-2">
                        <span className="text-sm text-text-secondary">
                          Keep {tier}
                        </span>
                        <NumberInput
                          label={`Keep ${tier}`}
                          value={draft[`keep_${tier}`]}
                          invalid={Boolean(shown.keep)}
                          onChange={(value) => set(`keep_${tier}`, value)}
                        />
                      </div>
                    ))}
                  </div>
                  <div
                    role="status"
                    className="space-y-1 rounded-md border border-border-quiet bg-raised-surface px-4 py-3"
                  >
                    <p className="text-sm text-text-primary">
                      Keeps up to {kept} cop{kept === 1 ? "y" : "ies"}
                      {dumpBytes
                        ? `, about ${formatBackupBytes(kept * dumpBytes)} per destination at the current dump size (${formatBackupBytes(dumpBytes)}).`
                        : " per destination."}
                    </p>
                    <p className="font-mono text-label text-text-subtle">
                      Reaches back {reachText(counts)} · local dumps keep their
                      own counts ({local.keep_daily}/{local.keep_weekly}/
                      {local.keep_monthly})
                    </p>
                  </div>
                  <RetentionStrip counts={counts} today={new Date(now)} />
                </div>
              </Row>
              <Row
                label="Compression"
                hint="restic compression. pg_dump output is already compressed, so Auto saves little extra and keeps the CPU low."
              >
                <SegmentedControl<Compression>
                  as="radio"
                  label="Compression"
                  value={draft.compression}
                  onValueChange={(value) => set("compression", value)}
                  items={[
                    { value: "auto", label: "Auto" },
                    { value: "max", label: "Max" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </Row>
              <Row
                label="Verify"
                hint={`restic check, reading a random subset of the data${
                  meanRepo && readPercent
                    ? `: about ${formatBackupBytes((meanRepo * readPercent) / 100)} downloaded from each destination`
                    : ""
                }. 0 days turns it off.`}
                error={shown.verify_every_days}
              >
                <span className="text-sm text-text-secondary">Every</span>
                <NumberInput
                  label="Verify every N days"
                  max={365}
                  value={draft.verify_every_days}
                  invalid={Boolean(shown.verify_every_days)}
                  onChange={(value) => set("verify_every_days", value)}
                />
                <Unit>days, reading</Unit>
                <NumberInput
                  label="Percent of the data to read"
                  min={1}
                  max={100}
                  value={draft.verify_read_percent}
                  invalid={Boolean(shown.verify_every_days)}
                  onChange={(value) => set("verify_read_percent", value)}
                />
                <Unit>% of the data</Unit>
              </Row>
              <Row
                label="Restore drill"
                hint="Restores the latest snapshot into a throwaway database (crate_restore_drill), runs sanity queries and drops it; never touches the live database. 0 days turns it off."
                error={shown.drill_every_days}
              >
                <span className="text-sm text-text-secondary">Every</span>
                <NumberInput
                  label="Restore drill every N days"
                  max={365}
                  value={draft.drill_every_days}
                  invalid={Boolean(shown.drill_every_days)}
                  onChange={(value) => set("drill_every_days", value)}
                />
                <Unit>days, from</Unit>
                <AdminSelect
                  ariaLabel="Restore drill source"
                  value={drillSource}
                  onChange={(value) => set("drill_source", value)}
                  placeholder="Source"
                  allowClear={false}
                  triggerClassName="w-64 max-w-full"
                  options={drillOptions}
                />
              </Row>
            </div>
          </Section>
          <Section
            title="Destinations and tiers"
            description="Which copies each destination receives. Retention applies to each destination's own repository; estimates use the current dump size."
          >
            <TierMatrix
              destinations={overview.destinations}
              draft={draft}
              dumpBytes={dumpBytes}
              today={new Date(now)}
              onChange={(destinations) => set("destinations", destinations)}
            />
          </Section>
          <LocalRetention retention={local} onSaved={onChanged} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${current?.name ?? "the policy"}?`}
        description="Its runs stay in the history and its copies stay in the repositories until another policy prunes them."
        confirmLabel="Delete policy"
        tone="danger"
        pending={busy}
        onConfirm={remove}
      />
    </>
  );
}
