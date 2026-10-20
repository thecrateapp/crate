import { useEffect, useId, useRef, useState } from "react";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { RadioGroup, RadioGroupItem } from "@crate/ui/primitives/RadioGroup";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { api } from "@/lib/api";
import { mergeShowView, showErrorText } from "./show-import-presentation";

export interface ShowConsolidation {
  canonical_show_id: number;
  duplicate_show_ids: number[];
  revisions: Record<string, number>;
}

export interface ConsolidationRow {
  id: number;
  revision: number;
  artist_name: string;
  date: string;
  local_time?: string;
  venue: string;
  city: string;
  merged_into_id?: number;
  attendance_count: number;
  reminder_count: number;
}

export interface ConsolidationDraft {
  ids: string;
  rows: ConsolidationRow[];
  keep: number | null;
  merge: number[];
}

export function emptyConsolidationDraft(): ConsolidationDraft {
  return { ids: "", rows: [], keep: null, merge: [] };
}

const INVALID_IDS_TEXT = "Enter 2 to 10 different show IDs.";
const GONE_TEXT =
  "Some of these shows were deleted or already merged. Check the IDs and load them again.";
const LOAD_FAILED_TEXT = "Couldn't load these shows.";

function parseIds(value: string): number[] | null {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 10) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const ids = parts.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) return null;
  return new Set(ids).size === ids.length ? ids : null;
}

export function ShowConsolidationEditor({
  value,
  onValueChange,
  disabled,
  onReview,
}: {
  value: ConsolidationDraft;
  onValueChange: (next: ConsolidationDraft) => void;
  disabled: boolean;
  onReview: (selection: ShowConsolidation) => void;
}) {
  const idsId = useId();
  const hintId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loader = useRef<AbortController | null>(null);
  const locked = disabled || loading;
  const merging = new Set(value.merge);

  useEffect(() => () => loader.current?.abort(), []);

  async function load() {
    const ids = parseIds(value.ids);
    if (!ids) {
      setError(INVALID_IDS_TEXT);
      return;
    }
    loader.current?.abort();
    const abort = new AbortController();
    loader.current = abort;
    setLoading(true);
    setError("");
    // Reloading replaces the rows, so a reviewed merge stops applying now.
    onValueChange({ ...value, rows: [], keep: null, merge: [] });
    try {
      const result = await api<{ items: ConsolidationRow[] }>(
        `/api/show-imports/shows?${ids.map((id) => `ids=${id}`).join("&")}`,
        "GET",
        undefined,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      const rows = result.items ?? [];
      if (
        rows.length !== ids.length ||
        rows.some((row) => row.merged_into_id)
      ) {
        setError(GONE_TEXT);
        onValueChange({ ...value, rows: [], keep: null, merge: [] });
        return;
      }
      onValueChange({ ...value, rows, keep: rows[0]!.id, merge: [] });
    } catch (failure) {
      if (abort.signal.aborted) return;
      setError(showErrorText(failure, LOAD_FAILED_TEXT));
      onValueChange({ ...value, rows: [], keep: null, merge: [] });
    } finally {
      if (loader.current === abort) {
        loader.current = null;
        setLoading(false);
      }
    }
  }

  function review() {
    const keep = value.keep;
    if (keep === null || value.merge.length === 0) return;
    const chosen = value.rows.filter(
      (row) => row.id === keep || merging.has(row.id),
    );
    onReview({
      canonical_show_id: keep,
      duplicate_show_ids: value.rows
        .filter((row) => row.id !== keep && merging.has(row.id))
        .map((row) => row.id),
      revisions: Object.fromEntries(
        chosen.map((row) => [String(row.id), row.revision]),
      ),
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={idsId} className="text-sm font-medium">
          Show IDs
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={idsId}
            className="h-9 min-w-0 flex-1"
            inputMode="numeric"
            value={value.ids}
            disabled={locked}
            aria-describedby={hintId}
            onChange={(event) => {
              setError("");
              onValueChange({
                ids: event.target.value,
                rows: [],
                keep: null,
                merge: [],
              });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void load();
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => void load()}
          >
            Load shows
          </Button>
        </div>
        <p id={hintId} className="text-xs text-muted-foreground">
          2 to 10 show IDs separated by commas. A show&apos;s ID is the number
          after show_id= in its link.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-state-danger-text">
          {error}
        </p>
      ) : null}
      {value.rows.length ? (
        <>
          <RadioGroup
            aria-label="Show to keep"
            className="gap-2"
            value={value.keep === null ? "" : String(value.keep)}
            disabled={locked}
            onValueChange={(next) => {
              const keep = Number(next);
              onValueChange({
                ...value,
                keep,
                merge: value.merge.filter((id) => id !== keep),
              });
            }}
          >
            {value.rows.map((row) => {
              const view = mergeShowView(row);
              const kept = row.id === value.keep;
              return (
                <div
                  key={row.id}
                  data-kept={kept ? "" : undefined}
                  className="flex items-start gap-3 rounded-md border border-border p-3 data-[kept]:border-accent-action"
                >
                  <RadioGroupItem
                    value={String(row.id)}
                    aria-label={`Keep show ${row.id}`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                    <p className="font-medium">{view.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {`#${row.id} · ${view.detail}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {view.people}
                    </p>
                  </div>
                  {kept ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      Keep
                    </span>
                  ) : (
                    <Checkbox
                      aria-label={`Merge show ${row.id}`}
                      className="mt-0.5"
                      checked={merging.has(row.id)}
                      disabled={locked}
                      onCheckedChange={(checked) =>
                        onValueChange({
                          ...value,
                          merge:
                            checked === true
                              ? [...value.merge, row.id]
                              : value.merge.filter((id) => id !== row.id),
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </RadioGroup>
          <Button
            type="button"
            disabled={locked || value.merge.length === 0}
            onClick={review}
          >
            Review merge
          </Button>
        </>
      ) : null}
    </div>
  );
}
