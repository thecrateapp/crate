import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Users } from "@crate/ui/icons";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";

import type { CrateSummary } from "@/pages/crates-types";

export type CrateOrdering = "none" | "asc" | "desc";

export interface CrateFormValues {
  name: string;
  description: string;
  visibility: CrateSummary["visibility"];
  ordering: CrateOrdering;
  loopEnabled: boolean;
  collaborative: boolean;
}

export const EMPTY_CRATE_FORM_VALUES: CrateFormValues = {
  name: "",
  description: "",
  visibility: "private",
  ordering: "none",
  loopEnabled: false,
  collaborative: false,
};

export function crateFormValuesFromCrate(
  crate: Pick<
    CrateSummary,
    | "name"
    | "description"
    | "visibility"
    | "is_ordered"
    | "sort_direction"
    | "loop_enabled"
    | "is_collaborative"
  >,
): CrateFormValues {
  return {
    name: crate.name,
    description: crate.description ?? "",
    visibility: crate.visibility,
    ordering: crate.is_ordered ? crate.sort_direction : "none",
    loopEnabled: crate.loop_enabled,
    collaborative: crate.is_collaborative,
  };
}

export function isCrateFormValid(values: CrateFormValues) {
  return values.name.trim().length > 0;
}

export function crateFormPayload(values: CrateFormValues, isOwner: boolean) {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    ...(isOwner
      ? {
          visibility: values.visibility,
          is_collaborative: values.collaborative,
        }
      : {}),
    is_ordered: values.ordering !== "none",
    sort_direction: values.ordering === "desc" ? "desc" : "asc",
    loop_enabled: values.loopEnabled,
  };
}

const TOGGLE_CLASS =
  "flex min-h-11 items-center gap-3 rounded-lg bg-text-primary/[0.035] px-3 py-2 text-sm text-text-primary";

export function CrateForm({
  id,
  values,
  isOwner,
  disabled = false,
  onChange,
  onSubmit,
}: {
  id: string;
  values: CrateFormValues;
  isOwner: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<CrateFormValues>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();

  return (
    <form
      id={id}
      onSubmit={onSubmit}
      className="space-y-4"
      data-testid="crate-form"
    >
      <fieldset disabled={disabled} className="space-y-4">
        <FormField className="gap-2" label={t("common.name")}>
          <Input
            value={values.name}
            onChange={(event) => onChange({ name: event.target.value })}
            maxLength={120}
            required
          />
        </FormField>
        <FormField className="gap-2" label={t("library.crates.description")}>
          <Textarea
            value={values.description}
            onChange={(event) => onChange({ description: event.target.value })}
            maxLength={2000}
            rows={3}
          />
        </FormField>
        <div className="grid gap-4 rounded-xl border border-border-quiet bg-text-primary/[0.025] p-4 sm:grid-cols-2">
          {isOwner ? (
            <FormField className="gap-2" label={t("library.crates.visibility")}>
              {(control) => (
                <Select
                  value={values.visibility}
                  onValueChange={(value) =>
                    onChange({
                      visibility: value as CrateFormValues["visibility"],
                    })
                  }
                >
                  <SelectTrigger {...control} className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      {t("library.crates.private")}
                    </SelectItem>
                    <SelectItem value="public">
                      {t("library.crates.public")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField className="gap-2" label={t("library.crates.ordering")}>
            {(control) => (
              <Select
                value={values.ordering}
                onValueChange={(value) =>
                  onChange({ ordering: value as CrateOrdering })
                }
              >
                <SelectTrigger {...control} className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("library.crates.unordered")}
                  </SelectItem>
                  <SelectItem value="asc">
                    {t("library.crates.ascending")}
                  </SelectItem>
                  <SelectItem value="desc">
                    {t("library.crates.descending")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          <label className={TOGGLE_CLASS}>
            <Checkbox
              checked={values.loopEnabled}
              onCheckedChange={(checked) =>
                onChange({ loopEnabled: checked === true })
              }
              aria-label={t("library.crates.loopPlayback")}
            />
            {t("library.crates.loopPlayback")}
          </label>
          {isOwner ? (
            <label className={TOGGLE_CLASS}>
              <Checkbox
                checked={values.collaborative}
                onCheckedChange={(checked) =>
                  onChange({ collaborative: checked === true })
                }
                aria-label={t("library.crates.allowCollaboration")}
              />
              <Users size={CRATE_ICON_SIZE.sm} className="text-accent-action" />
              {t("library.crates.allowCollaboration")}
            </label>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
