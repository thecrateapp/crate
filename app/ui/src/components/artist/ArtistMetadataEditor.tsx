import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FormField } from "@crate/ui/primitives/FormField";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { ArtistBioResearchAction } from "./ArtistBioResearchAction";

import { api } from "@/lib/api";
import { artistActionApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

import type { ArtistData } from "./artistPageTypes";
import { ArtistGenreSelector } from "./ArtistGenreSelector";
import { ArtistBioResearchDialog } from "./ArtistBioResearchDialog";

interface ArtistMetadataEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistData;
  onSaved?: () => void;
}

interface ArtistMetadataFormState {
  bio: string;
  genres: string[];
  urls: string;
  mbid: string;
  country: string;
  area: string;
  formed: string;
  ended: string;
  artist_type: string;
  bandcamp_url: string;
}

function urlsToLines(urls: Record<string, string> | undefined) {
  return Object.entries(urls ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseUrls(value: string) {
  const urls: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const url = trimmed.slice(separatorIndex + 1).trim();
    if (key && url) urls[key] = url;
  }
  return urls;
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function initialState(artist: ArtistData): ArtistMetadataFormState {
  return {
    bio: artist.bio ?? "",
    genres: artist.manual_genres ?? [],
    urls: urlsToLines(artist.urls_json),
    mbid: artist.mbid ?? "",
    country: artist.country ?? "",
    area: artist.area ?? "",
    formed: artist.formed ?? "",
    ended: artist.ended ?? "",
    artist_type: artist.artist_type ?? "",
    bandcamp_url: artist.bandcamp_url ?? "",
  };
}

export function ArtistMetadataEditor({
  open,
  onOpenChange,
  artist,
  onSaved,
}: ArtistMetadataEditorProps) {
  const [values, setValues] = useState<ArtistMetadataFormState>(() =>
    initialState(artist),
  );
  const [saving, setSaving] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (open) setValues(initialState(artist));
  }, [artist, open]);

  function updateField<K extends keyof ArtistMetadataFormState>(
    key: K,
    value: ArtistMetadataFormState[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function closeEditor(nextOpen: boolean) {
    if (!nextOpen && !saving) {
      const dirty =
        JSON.stringify(values) !== JSON.stringify(initialState(artist));
      if (dirty) {
        setDiscardOpen(true);
        return;
      }
    }
    onOpenChange(nextOpen);
  }

  async function save() {
    setSaving(true);
    try {
      const endpoint = artistActionApiPath(
        { artistId: artist.id, artistEntityUid: artist.entity_uid },
        "metadata",
      );
      if (!endpoint) throw new Error("Artist reference missing");

      const { task_id } = await api<{ task_id: string }>(endpoint, "PUT", {
        bio: blankToNull(values.bio),
        genres: values.genres,
        urls: parseUrls(values.urls),
        mbid: blankToNull(values.mbid),
        country: blankToNull(values.country),
        area: blankToNull(values.area),
        formed: blankToNull(values.formed),
        ended: blankToNull(values.ended),
        artist_type: blankToNull(values.artist_type),
        bandcamp_url: blankToNull(values.bandcamp_url),
      });

      toast.success("Saving artist metadata...");
      const task = await waitForTask(task_id, 60000);
      if (task.status === "completed") {
        toast.success("Artist metadata saved");
        onSaved?.();
        onOpenChange(false);
      } else {
        toast.error("Failed to save artist metadata");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={closeEditor}>
        <DialogContent className="flex max-h-[min(92dvh,960px)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-display">
              Edit artist metadata
            </DialogTitle>
            <DialogDescription>
              Update descriptive library metadata for {artist.name}. Audio files
              are not modified by this action.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain py-2 pr-1">
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MonoLabel as="h3" tone="accent">
                  Editorial data
                </MonoLabel>
                <ArtistBioResearchAction
                  onClick={() => setResearchOpen(true)}
                  disabled={saving}
                />
              </div>
              <FormField label="Biography" hint={`${values.bio.length}/4000`}>
                <Textarea
                  aria-label="Bio"
                  value={values.bio}
                  onChange={(event) => updateField("bio", event.target.value)}
                  rows={5}
                  maxLength={4000}
                />
              </FormField>
            </section>

            <section className="space-y-3">
              <MonoLabel as="h3" tone="accent">
                Genres
              </MonoLabel>
              <p className="m-0 text-sm text-text-muted">
                Choose canonical taxonomy genres. Provider tags remain stored
                separately.
              </p>
              <ArtistGenreSelector
                value={values.genres}
                onChange={(genres) => updateField("genres", genres)}
                disabled={saving}
              />
            </section>

            <section className="space-y-3">
              <MonoLabel as="h3" tone="accent">
                Identity
              </MonoLabel>
              <div className="grid gap-4 md:grid-cols-2">
                {(
                  [
                    ["mbid", "MusicBrainz ID"],
                    ["bandcamp_url", "Bandcamp URL"],
                    ["country", "Country"],
                    ["area", "Area"],
                    ["formed", "Formed"],
                    ["ended", "Ended"],
                  ] as const
                ).map(([field, label]) => (
                  <FormField key={field} label={label}>
                    <Input
                      value={values[field]}
                      onChange={(event) =>
                        updateField(field, event.target.value)
                      }
                      placeholder={
                        field === "formed"
                          ? "1998"
                          : field === "ended"
                            ? "optional"
                            : undefined
                      }
                    />
                  </FormField>
                ))}
                <FormField label="Type">
                  {(control) => (
                    <AdminSelect
                      {...control}
                      value={values.artist_type}
                      onChange={(value) => updateField("artist_type", value)}
                      placeholder="Not specified"
                      options={[
                        { value: "", label: "Not specified" },
                        { value: "Group", label: "Group" },
                        { value: "Person", label: "Person" },
                        { value: "Character", label: "Character" },
                        { value: "Other", label: "Other" },
                      ]}
                    />
                  )}
                </FormField>
              </div>
            </section>

            <section className="space-y-3">
              <MonoLabel as="h3" tone="accent">
                External links
              </MonoLabel>
              <FormField
                label="External URLs"
                hint="One per line as label=https://…"
              >
                <Textarea
                  aria-label="External URLs"
                  value={values.urls}
                  onChange={(event) => updateField("urls", event.target.value)}
                  rows={4}
                  placeholder="official=https://example.com"
                />
              </FormField>
            </section>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeEditor(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={saving}
              loading={saving}
            >
              Save metadata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard artist metadata changes?"
        description="Your unsaved edits will be lost."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
      <ArtistBioResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        artist={artist}
        currentBio={values.bio}
        onApply={(bio) => updateField("bio", bio)}
      />
    </>
  );
}
