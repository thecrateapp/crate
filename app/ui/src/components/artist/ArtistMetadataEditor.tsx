import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

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

import { api } from "@/lib/api";
import { artistActionApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

import type { ArtistData } from "./artistPageTypes";

interface ArtistMetadataEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistData;
  onSaved?: () => void;
}

interface ArtistMetadataFormState {
  bio: string;
  tags: string;
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

function tagsToList(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value.split(",")) {
    const tag = item.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

function blankToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function initialState(artist: ArtistData): ArtistMetadataFormState {
  return {
    bio: artist.bio ?? "",
    tags: (artist.tags_json ?? artist.genres ?? []).join(", "),
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

  useEffect(() => {
    if (open) setValues(initialState(artist));
  }, [artist, open]);

  function updateField<K extends keyof ArtistMetadataFormState>(
    key: K,
    value: ArtistMetadataFormState[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
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
        tags: tagsToList(values.tags),
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit artist metadata</DialogTitle>
          <DialogDescription>
            Update descriptive library metadata for {artist.name}. Audio files
            are not modified by this action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <label className="grid gap-2 text-sm">
            <span className="text-muted-foreground">Bio</span>
            <Textarea
              value={values.bio}
              onChange={(event) => updateField("bio", event.target.value)}
              rows={5}
            />
          </label>

          <label className="grid gap-2 text-sm">
            <span className="text-muted-foreground">Tags</span>
            <Input
              value={values.tags}
              onChange={(event) => updateField("tags", event.target.value)}
              placeholder="screamo, post-hardcore"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">MusicBrainz ID</span>
              <Input
                value={values.mbid}
                onChange={(event) => updateField("mbid", event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Bandcamp URL</span>
              <Input
                value={values.bandcamp_url}
                onChange={(event) =>
                  updateField("bandcamp_url", event.target.value)
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Country</span>
              <Input
                value={values.country}
                onChange={(event) => updateField("country", event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Area</span>
              <Input
                value={values.area}
                onChange={(event) => updateField("area", event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Formed</span>
              <Input
                value={values.formed}
                onChange={(event) => updateField("formed", event.target.value)}
                placeholder="1998"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Ended</span>
              <Input
                value={values.ended}
                onChange={(event) => updateField("ended", event.target.value)}
                placeholder="optional"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted-foreground">Type</span>
              <Input
                value={values.artist_type}
                onChange={(event) =>
                  updateField("artist_type", event.target.value)
                }
                placeholder="Group, Person..."
              />
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="text-muted-foreground">
              External URLs, one per line as label=url
            </span>
            <Textarea
              value={values.urls}
              onChange={(event) => updateField("urls", event.target.value)}
              rows={4}
              placeholder="official=https://example.com"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? (
              <RefreshCw size={14} className="mr-2 animate-spin" />
            ) : null}
            Save metadata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
