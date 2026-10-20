import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import type { CrateSummary } from "../../pages/crates-types";

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
        <FormField label={t("common.name")}>
          <Input
            value={values.name}
            onChange={(event) => onChange({ name: event.target.value })}
            maxLength={120}
            required
          />
        </FormField>
        <FormField label={t("library.crates.description")}>
          <Textarea
            value={values.description}
            onChange={(event) => onChange({ description: event.target.value })}
            maxLength={2000}
            rows={3}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          {isOwner ? (
            <FormField label={t("library.crates.visibility")}>
              {(control) => (
                <Select
                  value={values.visibility}
                  onValueChange={(value) =>
                    onChange({
                      visibility: value as CrateFormValues["visibility"],
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger {...control} className="w-full">
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
          <FormField label={t("library.crates.ordering")}>
            {(control) => (
              <Select
                value={values.ordering}
                onValueChange={(value) =>
                  onChange({ ordering: value as CrateOrdering })
                }
                disabled={disabled}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["none", "asc", "desc"] as const).map((value, index) => (
                    <SelectItem key={value} value={value}>
                      {t(
                        [
                          "library.crates.unordered",
                          "library.crates.ascending",
                          "library.crates.descending",
                        ][index]!,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField layout="inline" label={t("library.crates.loopPlayback")}>
            <Checkbox
              checked={values.loopEnabled}
              onCheckedChange={(checked) =>
                onChange({ loopEnabled: checked === true })
              }
            />
          </FormField>
          {isOwner ? (
            <FormField
              layout="inline"
              label={t("library.crates.allowCollaboration")}
            >
              <Checkbox
                checked={values.collaborative}
                onCheckedChange={(checked) =>
                  onChange({ collaborative: checked === true })
                }
              />
            </FormField>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
