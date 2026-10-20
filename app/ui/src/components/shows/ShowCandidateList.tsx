import { useId, useState, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { formatShowDateParts } from "@crate/ui/domain/shows/show-types";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ShowCandidateFields } from "./ShowCandidateFields";
import {
  MAX_SELECTED_SHOWS,
  fillTargets,
  missingFields,
  savedItemIds,
  selectAllValid,
  type SharedShowFields,
  type ShowDraftState,
} from "./show-draft";
import { countLabel, outcomeView } from "./show-import-presentation";
import type { ShowCandidate, ShowOutcome } from "./show-import-types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function rowDateLabel(date?: string | null): string {
  return date && ISO_DATE.test(date)
    ? formatShowDateParts(date, "").dateLabel
    : "";
}

function FillPanel({
  draft,
  saved,
  locked,
  onFill,
}: {
  draft: ShowDraftState;
  saved: Set<string>;
  locked: boolean;
  onFill: (values: SharedShowFields, ids: string[]) => void;
}) {
  const artistId = useId();
  const countryId = useId();
  const [artist, setArtist] = useState("");
  const [country, setCountry] = useState("");
  const targets = fillTargets(draft, saved);
  const count = targets.ids.length;
  const values: SharedShowFields = {
    ...(artist.trim() ? { artist_name: artist.trim() } : {}),
    ...(country.trim() ? { country_code: country.trim() } : {}),
  };
  const canApply = !locked && count > 0 && Object.keys(values).length > 0;

  function apply() {
    if (!canApply) return;
    onFill(values, targets.ids);
    setArtist("");
    setCountry("");
  }

  function applyOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  }

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        Fill in several shows
      </legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="space-y-1">
          <label
            htmlFor={artistId}
            className="block text-xs font-medium text-muted-foreground"
          >
            Artist
          </label>
          <Input
            id={artistId}
            aria-label="Artist for several shows"
            className="h-9"
            value={artist}
            maxLength={240}
            disabled={locked}
            onChange={(event) => setArtist(event.target.value)}
            onKeyDown={applyOnEnter}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={countryId}
            className="block text-xs font-medium text-muted-foreground"
          >
            Country code
          </label>
          <Input
            id={countryId}
            aria-label="Country code for several shows"
            className="h-9"
            value={country}
            maxLength={2}
            disabled={locked}
            onChange={(event) => setCountry(event.target.value)}
            onKeyDown={applyOnEnter}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canApply}
        onClick={apply}
      >
        {targets.scope === "selected"
          ? `Apply to ${countLabel(count, "selected show")}`
          : `Apply to all ${countLabel(count, "unsaved show")}`}
      </Button>
    </fieldset>
  );
}

export function ShowCandidateList({
  draft,
  outcomes,
  locked,
  showMissing,
  onChange,
  onSelect,
  onFill,
  onRemove,
}: {
  draft: ShowDraftState;
  outcomes: ShowOutcome[];
  locked: boolean;
  showMissing: (candidate: ShowCandidate) => boolean;
  onChange: (candidate: ShowCandidate) => void;
  onSelect: (ids: string[]) => void;
  onFill: (values: SharedShowFields, ids: string[]) => void;
  onRemove?: (itemId: string) => void;
}) {
  const saved = savedItemIds(outcomes);
  const outcomeById = new Map(
    outcomes.map((outcome) => [outcome.item_id, outcome]),
  );
  const selected = new Set(draft.selected);
  const unsaved = draft.candidates.filter(
    (candidate) => !saved.has(candidate.item_id),
  );
  const savedCount = draft.candidates.length - unsaved.length;
  const selectedCount = unsaved.filter((candidate) =>
    selected.has(candidate.item_id),
  ).length;
  const validCount = unsaved.filter(
    (candidate) => missingFields(candidate).length === 0,
  ).length;
  const validIds = selectAllValid(draft, saved);
  const canRemove = Boolean(onRemove) && draft.candidates.length >= 2;

  return (
    <section aria-label="Shows to add" className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {`${selectedCount} of ${unsaved.length} shows selected${
            savedCount > 0 ? ` · ${savedCount} saved` : ""
          }`}
        </p>
        <p className="text-xs text-muted-foreground">
          Leave the time empty when the source doesn't give one.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked || validIds.length === 0}
            title={
              validIds.length === 0 ? "No show is complete yet" : undefined
            }
            onClick={() => onSelect(validIds)}
          >
            Select all valid
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked || draft.selected.length === 0}
            onClick={() => onSelect([])}
          >
            Clear selection
          </Button>
        </div>
        {validCount > MAX_SELECTED_SHOWS ? (
          <p className="text-xs text-muted-foreground">
            Up to 50 shows per save. The rest stay here for the next batch.
          </p>
        ) : null}
      </div>
      <FillPanel draft={draft} saved={saved} locked={locked} onFill={onFill} />
      <ol className="space-y-3">
        {draft.candidates.map((candidate, index) => {
          const number = index + 1;
          const outcome = outcomeById.get(candidate.item_id);
          const isSaved = saved.has(candidate.item_id);
          const result = outcome ? outcomeView(outcome) : null;
          const missing = showMissing(candidate)
            ? missingFields(candidate).length
            : 0;
          const dateLabel = rowDateLabel(candidate.date);
          return (
            <li
              key={candidate.item_id}
              className="space-y-3 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  aria-label={`Select show ${number}`}
                  checked={selected.has(candidate.item_id)}
                  disabled={isSaved || locked}
                  onCheckedChange={(checked) =>
                    onSelect(
                      checked === true
                        ? [...draft.selected, candidate.item_id]
                        : draft.selected.filter(
                            (id) => id !== candidate.item_id,
                          ),
                    )
                  }
                />
                <h4 className="text-sm font-medium">
                  {dateLabel
                    ? `Show ${number} · ${dateLabel}`
                    : `Show ${number}`}
                </h4>
                <div className="ml-auto flex items-center gap-2">
                  {result ? (
                    <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                  ) : missing > 0 ? (
                    <StatusBadge tone="warning">{`${missing} missing`}</StatusBadge>
                  ) : null}
                  {/* Imported rows stay; only rows typed here can go. */}
                  {canRemove && !isSaved && !candidate.source_draft_id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove show ${number}`}
                      disabled={locked}
                      onClick={() => onRemove?.(candidate.item_id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <ShowCandidateFields
                candidate={candidate}
                index={index}
                locked={locked}
                showMissing={showMissing(candidate)}
                outcome={outcome}
                onChange={onChange}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
