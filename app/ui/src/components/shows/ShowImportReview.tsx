import { Fragment } from "react";
import { Input } from "@crate/ui/shadcn/input";
import {
  isShowSaved,
  type ShowCandidate,
  type ShowOutcome,
} from "./show-import-types";

type TextField =
  | "artist_uid"
  | "artist_name"
  | "date"
  | "local_time"
  | "venue"
  | "city"
  | "country_code"
  | "country"
  | "region"
  | "timezone"
  | "doors_time"
  | "tickets_url"
  | "url"
  | "image_url"
  | "price_range"
  | "address_line1"
  | "postal_code";
const fields: { key: TextField; label: string; type?: string }[] = [
  { key: "artist_name", label: "Artist" },
  { key: "date", label: "Date", type: "date" },
  { key: "local_time", label: "Time", type: "time" },
  { key: "venue", label: "Venue" },
  { key: "city", label: "City" },
];
const details: { key: TextField; label: string; type?: string }[] = [
  { key: "artist_uid", label: "Exact library artist UID (optional)" },
  { key: "country_code", label: "Country code" },
  { key: "country", label: "Country" },
  { key: "region", label: "Region" },
  { key: "timezone", label: "IANA timezone" },
  { key: "doors_time", label: "Doors time", type: "time" },
  { key: "tickets_url", label: "Tickets URL", type: "url" },
  { key: "url", label: "Event URL", type: "url" },
  { key: "image_url", label: "Image URL", type: "url" },
  { key: "price_range", label: "Price" },
  { key: "address_line1", label: "Address" },
  { key: "postal_code", label: "Postal code" },
];

interface Props {
  candidates: ShowCandidate[];
  selected: string[];
  disabled?: boolean;
  outcomes?: ShowOutcome[];
  onChange: (candidate: ShowCandidate) => void;
  onSelect: (ids: string[]) => void;
}

export function ShowImportReview({
  candidates,
  selected,
  disabled,
  outcomes = [],
  onChange,
  onSelect,
}: Props) {
  const selectedIds = new Set(selected);
  const results = new Map(
    outcomes.map((outcome) => [outcome.item_id, outcome]),
  );
  const name = (label: string, index: number) =>
    candidates.length === 1 ? label : `${label} for show ${index + 1}`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {selected.length} selected ·{" "}
        {candidates.length - outcomes.filter(isShowSaved).length} unsaved.
        Unknown times stay empty.
      </p>
      <div className="overflow-x-auto">
        <table
          aria-label="Show candidates"
          className={
            candidates.length === 1 ? "block w-full" : "w-full border-collapse"
          }
        >
          <thead
            className={
              candidates.length === 1
                ? "sr-only"
                : "text-left text-xs text-muted-foreground"
            }
          >
            <tr>
              <th className="p-2">Selection</th>
              {fields.map((field) => (
                <th className="p-2" key={field.key}>
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={candidates.length === 1 ? "block" : ""}>
            {candidates.map((candidate, index) => {
              const outcome = results.get(candidate.item_id);
              const locked = disabled || isShowSaved(outcome);
              return (
                <Fragment key={candidate.item_id}>
                  <tr
                    className={
                      candidates.length === 1
                        ? "grid gap-3 sm:grid-cols-2"
                        : "border-t border-border"
                    }
                  >
                    <td className="p-2 align-top">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={locked}
                          aria-label={`Select show ${index + 1}`}
                          checked={selectedIds.has(candidate.item_id)}
                          onChange={(event) =>
                            onSelect(
                              event.target.checked
                                ? [...selected, candidate.item_id]
                                : selected.filter(
                                    (id) => id !== candidate.item_id,
                                  ),
                            )
                          }
                        />
                        Show {index + 1}
                      </label>
                    </td>
                    {fields.map((field) => (
                      <td key={field.key} className="p-2 align-top">
                        <label className="text-sm">
                          <span
                            className={
                              candidates.length === 1 ? "block" : "sr-only"
                            }
                          >
                            {field.label}
                          </span>
                          <Input
                            aria-label={name(field.label, index)}
                            disabled={locked}
                            className={candidates.length > 1 ? "min-w-32" : ""}
                            type={field.type ?? "text"}
                            value={candidate[field.key] ?? ""}
                            required={
                              field.key !== "local_time" &&
                              selectedIds.has(candidate.item_id)
                            }
                            maxLength={
                              field.key === "artist_name" ||
                              field.key === "venue" ||
                              field.key === "city"
                                ? 240
                                : undefined
                            }
                            onChange={(event) =>
                              onChange({
                                ...candidate,
                                [field.key]: event.target.value,
                                ...(field.key === "artist_name"
                                  ? { artist_uid: null }
                                  : {}),
                              })
                            }
                          />
                        </label>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={6} className="p-2">
                      <fieldset disabled={locked} className="space-y-2">
                        {fields.filter(
                          (field) =>
                            field.key !== "local_time" && !candidate[field.key],
                        ).length ? (
                          <p className="text-xs text-muted-foreground">
                            Missing:{" "}
                            {fields
                              .filter(
                                (field) =>
                                  field.key !== "local_time" &&
                                  !candidate[field.key],
                              )
                              .map((field) => field.label)
                              .join(", ")}
                            . Complete before selecting this date.
                          </p>
                        ) : null}
                        <details>
                          <summary className="cursor-pointer text-sm">
                            More event details
                          </summary>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {details.map((field) => (
                              <label key={field.key} className="text-sm">
                                {field.label}
                                <Input
                                  aria-label={name(field.label, index)}
                                  type={field.type ?? "text"}
                                  value={candidate[field.key] ?? ""}
                                  maxLength={field.type === "url" ? 2048 : 240}
                                  onChange={(event) =>
                                    onChange({
                                      ...candidate,
                                      [field.key]: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            ))}
                            <label className="text-sm">
                              Lineup (comma-separated)
                              <Input
                                aria-label={name("Lineup", index)}
                                value={(candidate.lineup ?? []).join(", ")}
                                onChange={(event) =>
                                  onChange({
                                    ...candidate,
                                    lineup: event.target.value
                                      .split(",")
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  })
                                }
                              />
                            </label>
                            <label className="text-sm">
                              Status
                              <select
                                aria-label={name("Status", index)}
                                className="block h-9 w-full rounded-md border border-input bg-background px-3"
                                value={candidate.status ?? "scheduled"}
                                onChange={(event) =>
                                  onChange({
                                    ...candidate,
                                    status: event.target.value,
                                  })
                                }
                              >
                                {[
                                  "scheduled",
                                  "onsale",
                                  "offsale",
                                  "cancelled",
                                  "postponed",
                                  "rescheduled",
                                ].map((status) => (
                                  <option key={status}>{status}</option>
                                ))}
                              </select>
                            </label>
                            {(["latitude", "longitude"] as const).map((key) => (
                              <label key={key} className="text-sm">
                                {key === "latitude" ? "Latitude" : "Longitude"}
                                <Input
                                  aria-label={name(
                                    key === "latitude"
                                      ? "Latitude"
                                      : "Longitude",
                                    index,
                                  )}
                                  type="number"
                                  step="any"
                                  min={key === "latitude" ? -90 : -180}
                                  max={key === "latitude" ? 90 : 180}
                                  value={candidate[key] ?? ""}
                                  onChange={(event) =>
                                    onChange({
                                      ...candidate,
                                      [key]:
                                        event.target.value === ""
                                          ? null
                                          : Number(event.target.value),
                                    })
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </details>
                        {candidate.source_ref ? (
                          <p className="break-all text-xs text-muted-foreground">
                            Source: {candidate.source_ref}
                          </p>
                        ) : null}
                        {candidate.evidence ? (
                          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                            Evidence: {candidate.evidence}
                          </p>
                        ) : null}
                        {outcome ? (
                          <p role="status" className="text-sm">
                            {outcome.status}
                            {outcome.show_id ? (
                              <>
                                {" "}
                                ·{" "}
                                <a
                                  className="underline"
                                  href={`/shows?show_id=${outcome.show_id}`}
                                >
                                  Open show {outcome.show_id}
                                </a>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </fieldset>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Coordinates and timezone are optional. Shows without coordinates remain
        in lists and may be excluded by nearby filters.
      </p>
    </div>
  );
}
