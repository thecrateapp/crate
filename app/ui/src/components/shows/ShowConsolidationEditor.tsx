import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { api } from "@/lib/api";
interface Row {
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
export interface ShowConsolidation {
  canonical_show_id: number;
  duplicate_show_ids: number[];
  revisions: Record<string, number>;
}
export function ShowConsolidationEditor({
  disabled,
  onChange,
  onReview,
}: {
  disabled: boolean;
  onChange: () => void;
  onReview: (selection: ShowConsolidation) => void;
}) {
  const [ids, setIds] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [canonical, setCanonical] = useState(0);
  const [duplicates, setDuplicates] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const duplicateIds = new Set(duplicates);
  async function load() {
    onChange();
    const chosen = ids.split(",").map((value) => Number(value.trim()));
    if (
      chosen.length < 2 ||
      chosen.length > 10 ||
      new Set(chosen).size !== chosen.length ||
      chosen.some((value) => !Number.isSafeInteger(value) || value < 1)
    ) {
      setError("Choose 2 to 10 distinct existing show IDs.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: Row[] }>(
        `/api/show-imports/shows?${chosen.map((id) => `ids=${id}`).join("&")}`,
      );
      if (
        result.items.length !== chosen.length ||
        result.items.some((row) => row.merged_into_id)
      )
        throw new Error(
          "Some IDs were removed or already consolidated. Load the current canonical IDs.",
        );
      setRows(result.items);
      setCanonical(result.items[0]!.id);
      setDuplicates([]);
    } catch (failure) {
      setRows([]);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load selected shows",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <details className="rounded-md border border-border p-3">
      <summary>Consolidate existing shows</summary>
      <fieldset disabled={disabled || loading} className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Use this only when two saved records are the same performance. Known
          different sessions stay separate. Attendance, reminders and aliases
          transfer to the chosen canonical show; human approval is mandatory.
        </p>
        <label className="text-sm">
          Existing show IDs, separated by commas
          <Input
            value={ids}
            onChange={(event) => {
              setIds(event.target.value);
              setRows([]);
              onChange();
            }}
          />
        </label>
        <Button type="button" variant="outline" onClick={() => void load()}>
          Load shows for consolidation
        </Button>
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded border border-border p-2 text-sm"
          >
            <p>
              #{row.id} · {row.artist_name} · {row.date} ·{" "}
              {row.local_time || "Time unknown"} · {row.venue}, {row.city} ·{" "}
              {row.attendance_count} attendance / {row.reminder_count} reminders
            </p>
            <label>
              <input
                type="radio"
                name="canonical-show"
                checked={canonical === row.id}
                onChange={() => {
                  setCanonical(row.id);
                  setDuplicates((current) =>
                    current.filter((id) => id !== row.id),
                  );
                  onChange();
                }}
              />{" "}
              Keep this canonical show
            </label>
            {canonical !== row.id ? (
              <label className="ml-3">
                <input
                  type="checkbox"
                  checked={duplicateIds.has(row.id)}
                  onChange={(event) => {
                    setDuplicates((current) =>
                      event.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    );
                    onChange();
                  }}
                />{" "}
                Transfer this duplicate
              </label>
            ) : null}
          </div>
        ))}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {rows.length ? (
          <Button
            type="button"
            disabled={!duplicates.length}
            onClick={() =>
              onReview({
                canonical_show_id: canonical,
                duplicate_show_ids: duplicates,
                revisions: Object.fromEntries(
                  rows
                    .filter(
                      (row) => row.id === canonical || duplicateIds.has(row.id),
                    )
                    .map((row) => [String(row.id), row.revision]),
                ),
              })
            }
          >
            Review exact consolidation
          </Button>
        ) : null}
      </fieldset>
    </details>
  );
}
