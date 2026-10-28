import { useState, useEffect } from "react";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { FormField } from "@crate/ui/primitives/FormField";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { api } from "@/lib/api";
import { albumActionApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import { Save } from "@crate/ui/icons";

interface Track {
  filename: string;
  title?: string;
  tracknumber?: string;
  artist?: string;
}

interface TagEditorProps {
  albumId: number;
  albumEntityUid?: string;
  tags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  };
  tracks?: Track[];
  onSaved?: () => void;
}

export function TagEditor({
  albumId,
  albumEntityUid,
  tags,
  tracks,
  onSaved,
}: TagEditorProps) {
  const [values, setValues] = useState({
    artist: tags.artist || "",
    albumartist: tags.artist || "",
    album: tags.album || "",
    date: tags.year || "",
    genre: tags.genre || "",
  });
  const [trackEdits, setTrackEdits] = useState<
    Record<string, { title?: string; tracknumber?: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [showTracks, setShowTracks] = useState(true);
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);

  useEffect(() => {
    api<{ name: string; count: number }[]>("/api/genres")
      .then((d) => {
        if (Array.isArray(d))
          setAvailableGenres(d.map((g) => g.name).slice(0, 50));
      })
      .catch(() => {});
  }, []);

  const currentGenres = values.genre
    .split(",")
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);

  function addGenre(g: string) {
    const lower = g.toLowerCase();
    if (!currentGenres.includes(lower)) {
      const updated = [...currentGenres, lower].join(", ");
      setValues({ ...values, genre: updated });
    }
  }

  function removeGenre(g: string) {
    const updated = currentGenres.filter((x) => x !== g).join(", ");
    setValues({ ...values, genre: updated });
  }

  function updateTrack(filename: string, field: string, value: string) {
    setTrackEdits((prev) => ({
      ...prev,
      [filename]: { ...prev[filename], [field]: value },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...values };
      if (Object.keys(trackEdits).length > 0) {
        body.tracks = trackEdits;
      }
      const { task_id } = await api<{ task_id: string }>(
        albumActionApiPath({ albumId, albumEntityUid }, "tags"),
        "PUT",
        body,
      );
      toast.success("Saving tags...");
      const task = await waitForTask(task_id, 60000);
      if (task.status === "completed") {
        toast.success(
          `Tags saved (${Number(task.result?.updated ?? 0)} tracks)`,
        );
        onSaved?.();
      } else if (task.status === "failed") {
        toast.error("Failed to save tags");
      }
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof typeof values) {
    return (
      <FormField label={label} id={`album-tag-${key}`}>
        <Input
          value={values[key]}
          onChange={(event) =>
            setValues({ ...values, [key]: event.target.value })
          }
        />
      </FormField>
    );
  }

  const currentGenreSet = new Set(currentGenres);
  const suggestedGenres = availableGenres.filter(
    (g) => !currentGenreSet.has(g.toLowerCase()),
  );

  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      label={{ children: "Album tags", tone: "accent" }}
      actions={
        <ActionButton label="Save Tags" loading={saving} onClick={save}>
          <Save data-admin-ux="album-save-tags" aria-hidden="true" />
        </ActionButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("Artist", "artist")}
        {field("Album artist", "albumartist")}
        {field("Album", "album")}
        {field("Year", "date")}
      </div>
      <div className="mt-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          {currentGenres.map((genre) => (
            <GenrePill
              key={genre}
              item={{ name: genre }}
              onRemove={() => removeGenre(genre)}
              removeLabel={`Remove genre ${genre}`}
            />
          ))}
        </div>
        <FormField
          label="Genres"
          hint="Comma-separated genre names"
          id="album-tag-genres"
        >
          <Input
            value={values.genre}
            onChange={(event) =>
              setValues({ ...values, genre: event.target.value })
            }
            placeholder="Comma-separated genres"
          />
        </FormField>
        {suggestedGenres.length ? (
          <div className="space-y-2">
            <MonoLabel as="div">Suggested genres</MonoLabel>
            <div className="flex flex-wrap gap-2">
              {suggestedGenres.slice(0, 20).map((genre) => (
                <GenrePill
                  key={genre}
                  item={{ name: genre }}
                  onClick={() => addGenre(genre)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {tracks?.length ? (
        <div className="mt-5 space-y-3 border-t border-border-quiet pt-4">
          <Button
            variant="ghost"
            aria-expanded={showTracks}
            aria-controls="album-track-tags"
            onClick={() => setShowTracks(!showTracks)}
          >
            {showTracks ? "Hide track tags" : "Edit track tags"} (
            {tracks.length})
          </Button>
          {showTracks ? (
            <div id="album-track-tags" className="space-y-3">
              {tracks.map((track) => {
                const edits = trackEdits[track.filename] || {};
                return (
                  <div
                    key={track.filename}
                    className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3"
                  >
                    <FormField
                      label={
                        <>
                          Track number{" "}
                          <span className="sr-only">for {track.filename}</span>
                        </>
                      }
                    >
                      <Input
                        aria-label={`Track number for ${track.filename}`}
                        value={edits.tracknumber ?? track.tracknumber ?? ""}
                        onChange={(event) =>
                          updateTrack(
                            track.filename,
                            "tracknumber",
                            event.target.value,
                          )
                        }
                      />
                    </FormField>
                    <FormField
                      label={
                        <>
                          Title{" "}
                          <span className="sr-only">for {track.filename}</span>
                        </>
                      }
                      hint={track.filename.split("/").pop()}
                    >
                      <Input
                        aria-label={`Title for ${track.filename}`}
                        value={edits.title ?? track.title ?? ""}
                        onChange={(event) =>
                          updateTrack(
                            track.filename,
                            "title",
                            event.target.value,
                          )
                        }
                      />
                    </FormField>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </InstrumentPanel>
  );
}
