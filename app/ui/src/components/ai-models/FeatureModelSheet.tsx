import { useState } from "react";
import { toast } from "sonner";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";

import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { AdminSelect } from "@/components/ui";
import { initialFeatureChoice, savedProfileOptions } from "@/lib/ai-models";
import { formatRelativeTime } from "@/lib/utils";

import { reportFailure, writeAI } from "./api";
import { ModelPicker, type ModelChoice } from "./ModelPicker";
import type { Action, Snapshot } from "./types";

type Source = "model" | "profile";

const SOURCES = [
  { value: "model" as const, label: "Choose a model" },
  { value: "profile" as const, label: "Use a saved profile" },
];

export function FeatureModelSheet({
  snapshot,
  action,
  open,
  onOpenChange,
  refresh,
}: {
  snapshot: Snapshot;
  action: Action;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => void;
}) {
  const [source, setSource] = useState<Source>("model");
  const [choice, setChoice] = useState<ModelChoice>(() =>
    initialFeatureChoice(snapshot, action.id),
  );
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);

  const binding =
    snapshot.bindings.find((candidate) => candidate.action_id === action.id) ??
    null;
  const feature = snapshot.default_model?.features.find(
    (candidate) => candidate.action_id === action.id,
  );
  const defaultModel = snapshot.default_model;
  const offerDefault =
    feature?.status === "override" && defaultModel?.available === true;
  const profiles = savedProfileOptions(snapshot, action.id);
  const selectedProfile =
    profiles.find((option) => option.profile.id === profileId) ?? null;
  const modelPath = `/actions/${encodeURIComponent(action.id)}/model`;

  async function run(write: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await write();
      toast.success(success);
      onOpenChange(false);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function applyModel(next: ModelChoice) {
    const body = {
      connection_id: next.connectionId,
      model_id: next.modelId,
      reasoning: next.reasoning,
      expected_revision: snapshot.revision,
      expected_review_fingerprint: snapshot.review_fingerprint,
    };
    void run(
      () => writeAI(modelPath, body),
      `${action.label} now uses ${next.modelId}`,
    );
  }

  function applyProfile() {
    if (!selectedProfile) return;
    const body = {
      changes: [
        {
          action_id: action.id,
          profile_id: selectedProfile.profile.id,
          profile_version: selectedProfile.version.version,
          enabled: binding?.enabled ?? true,
          expected_revision: binding?.revision ?? 0,
        },
      ],
    };
    void run(
      () => writeAI("/bindings", body),
      `${action.label} now uses ${selectedProfile.profile.label}`,
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Model for {action.label}</SheetTitle>
          <SheetDescription>Only this feature changes.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {offerDefault && defaultModel ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                applyModel({
                  connectionId: defaultModel.connection_id,
                  modelId: defaultModel.model_id,
                  reasoning: defaultModel.reasoning,
                })
              }
            >
              Use the default model
            </Button>
          ) : null}

          <SegmentedControl
            as="radio"
            label="Model source"
            items={SOURCES}
            value={source}
            onValueChange={setSource}
          />

          {source === "model" ? (
            <div className="space-y-3">
              <ModelPicker
                snapshot={snapshot}
                value={choice}
                onChange={(next) => setChoice(next)}
                feature={action}
                disabled={busy}
              />
              <Button
                disabled={busy || !choice.connectionId || !choice.modelId}
                onClick={() => applyModel(choice)}
              >
                Use this model
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {profiles.length > 0 ? (
                <AdminSelect
                  ariaLabel="Saved profile"
                  placeholder="Choose a saved profile"
                  allowClear={false}
                  value={selectedProfile ? selectedProfile.profile.id : ""}
                  options={profiles.map(({ profile, version }) => ({
                    value: profile.id,
                    label: `${profile.label} · ${version.model_id} · Updated ${formatRelativeTime(
                      version.created_at,
                      "en",
                    )}`,
                    searchText: profile.label,
                  }))}
                  disabled={busy}
                  triggerClassName="max-w-full"
                  menuClassName="w-[320px]"
                  onChange={setProfileId}
                />
              ) : (
                <p className="text-sm text-white/60">
                  No saved profile can run this feature.
                </p>
              )}
              <Button
                disabled={busy || !selectedProfile}
                onClick={() => applyProfile()}
              >
                Use this profile
              </Button>
            </div>
          )}

          <TechnicalDetails
            items={[
              { label: "Profile ID", value: binding?.profile_id },
              { label: "Profile version", value: binding?.profile_version },
              { label: "Binding revision", value: binding?.revision },
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
