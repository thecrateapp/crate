import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { useAuth } from "@/contexts/AuthContext";
import { configSummary, connectionName, findConnection } from "@/lib/ai-models";

import { BillableTestDialog } from "./BillableTestDialog";
import { ProfileForm } from "./ProfileForm";
import type { Profile, Snapshot, Version } from "./types";

const LEGACY_NOTE = "Kept from server settings. It can't be tested.";

function currentVersion(profile: Profile): Version | undefined {
  return (
    profile.versions.find(
      (version) => version.version === profile.current_version,
    ) ??
    // A truncated snapshot can miss the current version; show the newest.
    [...profile.versions].sort((a, b) => b.version - a.version)[0]
  );
}

function usedBy(snapshot: Snapshot, profile: Profile): string[] {
  const bound = new Set(
    snapshot.bindings
      .filter((binding) => binding.profile_id === profile.id)
      .map((binding) => binding.action_id),
  );
  return snapshot.actions
    .filter((action) => bound.has(action.id))
    .map((action) => action.label);
}

function EarlierVersions({ versions }: { versions: Version[] }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-white/70 hover:text-white"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-4" />
        )}
        Earlier versions ({versions.length})
      </button>
      {open ? (
        <ul id={contentId} role="list" className="mt-2 space-y-2">
          {versions.map((version) => (
            <li key={version.version} className="space-y-0.5 text-white/60">
              <p>
                Updated <RelativeTime value={version.created_at} />
              </p>
              <p>
                {version.model_id} · {configSummary(version.config)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProfileItem({
  snapshot,
  profile,
  canTest,
  canManage,
  onTest,
  onNewVersion,
}: {
  snapshot: Snapshot;
  profile: Profile;
  canTest: boolean;
  canManage: boolean;
  onTest: (version: Version) => void;
  onNewVersion: () => void;
}) {
  const current = currentVersion(profile);
  const legacy = current ? "kind" in current.config : false;
  const connection = current
    ? findConnection(snapshot, current.connection_id)
    : undefined;
  const features = usedBy(snapshot, profile);
  const earlier = profile.versions
    .filter((version) => version !== current)
    .sort((a, b) => b.version - a.version);

  return (
    <article
      aria-label={profile.label}
      className="space-y-3 rounded-md border border-white/10 bg-white/[0.02] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-white font-display">{profile.label}</h3>
          <p className="text-sm text-white/50">
            Updated{" "}
            <RelativeTime value={current?.created_at ?? profile.created_at} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current && !legacy && canTest ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Test ${profile.label}`}
              onClick={() => onTest(current)}
            >
              Test
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" size="sm" onClick={onNewVersion}>
              New version
            </Button>
          ) : null}
        </div>
      </div>

      {current ? (
        <div className="space-y-1 text-sm text-white/70">
          <p>
            {current.model_id} ·{" "}
            {connection ? connectionName(connection) : "Removed connection"}
          </p>
          <p>{legacy ? LEGACY_NOTE : configSummary(current.config)}</p>
          <p>
            {features.length > 0
              ? `Used by: ${features.join(", ")}`
              : "Not used by any feature"}
          </p>
        </div>
      ) : null}

      {earlier.length > 0 ? <EarlierVersions versions={earlier} /> : null}

      <TechnicalDetails
        items={[
          { label: "Profile ID", value: profile.id },
          { label: "Version", value: current?.version },
          { label: "Fingerprint", value: current?.fingerprint },
          { label: "Connection ID", value: current?.connection_id },
        ]}
      />
    </article>
  );
}

export function AdvancedPanel({
  snapshot,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("ai.config.manage");
  const canTest = hasCapability("ai.tests.run");
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const [test, setTest] = useState<{ version: Version; open: boolean } | null>(
    null,
  );
  const [form, setForm] = useState<{
    profile: Profile | null;
    open: boolean;
    opened: number;
  } | null>(null);

  const count = snapshot.profiles.length;
  // The form reads the profile from the latest snapshot so that, after a
  // conflict, it can adopt the refreshed current version.
  const formProfile = form?.profile
    ? snapshot.profiles.find((item) => item.id === form.profile?.id) ??
      form.profile
    : null;

  function openForm(profile: Profile | null) {
    setForm((current) => ({
      profile,
      open: true,
      opened: (current?.opened ?? 0) + 1,
    }));
  }

  return (
    <OpsPanel
      title="Advanced"
      description="Saved profiles with exact limits, and billable compatibility tests."
      action={
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls={expanded ? contentId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide advanced settings" : "Show advanced settings"}
        </Button>
      }
    >
      {expanded ? (
        <div id={contentId} className="space-y-4">
          {canManage ? (
            <Button onClick={() => openForm(null)}>New profile</Button>
          ) : null}
          {count === 0 ? (
            <p className="text-sm text-white/60">No saved profiles yet.</p>
          ) : (
            snapshot.profiles.map((profile) => (
              <ProfileItem
                key={profile.id}
                snapshot={snapshot}
                profile={profile}
                canTest={canTest}
                canManage={canManage}
                onTest={(version) => setTest({ version, open: true })}
                onNewVersion={() => openForm(profile)}
              />
            ))
          )}
        </div>
      ) : (
        <p className="text-sm text-white/50">
          {count === 1 ? "1 saved profile" : `${count} saved profiles`}
        </p>
      )}

      {test ? (
        <BillableTestDialog
          version={test.version}
          open={test.open}
          onOpenChange={(open) =>
            setTest((current) => (current ? { ...current, open } : current))
          }
          refresh={refresh}
        />
      ) : null}
      {form ? (
        <ProfileForm
          key={form.opened}
          snapshot={snapshot}
          profile={formProfile}
          open={form.open}
          onOpenChange={(open) =>
            setForm((current) => (current ? { ...current, open } : current))
          }
          refresh={refresh}
        />
      ) : null}
    </OpsPanel>
  );
}
