import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Bot, ImagePlus, Loader2, Search, Trash2 } from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { toast } from "sonner";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { waitForTask } from "@/lib/tasks";

type ArtworkSlot = "avatar" | "background" | "hero_desktop" | "hero_mobile";
type HeroComposition = "desktop" | "mobile";

export interface ArtistArtworkAsset {
  id: number;
  artist_id: number;
  origin: string;
  label: string;
  mime_type: string;
  width: number;
  height: number;
  checksum: string;
  slots: ArtworkSlot[];
  preview_url: string;
  created_at: string;
}

interface CandidateFit {
  score: number;
  label: "excellent" | "good" | "poor";
  reason: string;
}

interface ArtworkCandidate {
  id: string;
  origin: string;
  label: string;
  preview_url: string;
  width: number;
  height: number;
  desktop: CandidateFit;
  mobile: CandidateFit;
}

interface CandidateAnalysis {
  summary: string;
  desktop: { score: number; reason: string };
  mobile: { score: number; reason: string };
}

const SLOTS: Array<{ value: ArtworkSlot; label: string }> = [
  { value: "avatar", label: "Avatar" },
  { value: "background", label: "Background" },
  { value: "hero_desktop", label: "Hero desktop" },
  { value: "hero_mobile", label: "Hero mobile" },
];

function slotLabel(slot: ArtworkSlot) {
  return SLOTS.find((item) => item.value === slot)?.label ?? slot;
}

function originLabel(origin: string) {
  return origin.replace(/-/g, " ");
}

async function waitForQueuedTask(response: Response, fallback: string) {
  if (!response.ok) throw new Error(await response.text());
  const result = (await response.json()) as { task_id?: string };
  if (!result.task_id) return;
  const task = await waitForTask(result.task_id, 120_000);
  if (task.status === "failed") throw new Error(task.error || fallback);
}

export function ArtistArtworkGallery({
  artistId,
  artistName,
  canEdit,
  onChanged,
  onHeroChanged,
}: {
  artistId: number;
  artistName: string;
  canEdit: boolean;
  onChanged: () => void;
  onHeroChanged?: (composition: HeroComposition) => void;
}) {
  const heroAI = useActionLLMStatus("artwork.hero.analyze");
  const uploadRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<ArtistArtworkAsset[]>([]);
  const [candidates, setCandidates] = useState<ArtworkCandidate[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, CandidateAnalysis>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<ArtistArtworkAsset | null>(
    null,
  );
  const base = `/api/artwork/artists/${artistId}`;

  const loadAssets = useCallback(async () => {
    try {
      const response = await fetch(`${base}/assets`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as {
        assets: ArtistArtworkAsset[];
      };
      setAssets(payload.assets);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artwork gallery failed",
      );
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await waitForQueuedTask(
        await fetch(`${base}/assets/upload`, {
          method: "POST",
          credentials: "include",
          body: form,
        }),
        "Artwork import failed",
      );
      await loadAssets();
      toast.success("Image added to the artist gallery");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artwork import failed",
      );
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function assign(asset: ArtistArtworkAsset, slot: ArtworkSlot) {
    setBusy(`assign:${asset.id}:${slot}`);
    try {
      await waitForQueuedTask(
        await fetch(`${base}/slots/${slot}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset_id: asset.id }),
        }),
        "Artwork assignment failed",
      );
      await loadAssets();
      toast.success(`${slotLabel(slot)} updated`);
      onChanged();
      if (slot === "hero_desktop" || slot === "hero_mobile") {
        onHeroChanged?.(slot === "hero_desktop" ? "desktop" : "mobile");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artwork assignment failed",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteAsset(asset: ArtistArtworkAsset) {
    setBusy(`delete:${asset.id}`);
    try {
      await waitForQueuedTask(
        await fetch(`${base}/assets/${asset.id}`, {
          method: "DELETE",
          credentials: "include",
        }),
        "Artwork deletion failed",
      );
      await loadAssets();
      toast.success("Image removed from the artist gallery");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artwork deletion failed",
      );
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function discoverCandidates() {
    setDiscovering(true);
    try {
      const response = await fetch(`${base}/hero-candidates`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as {
        candidates: ArtworkCandidate[];
      };
      setCandidates(payload.candidates);
      if (payload.candidates.length === 0) {
        toast.info("No additional image candidates found");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Candidate discovery failed",
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function analyze(candidate: ArtworkCandidate) {
    setBusy(`analyze:${candidate.id}`);
    try {
      const response = await fetch(`${base}/hero-candidates/analyze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: candidate.id }),
      });
      if (response.status === 409) {
        toast.info("The configured model does not support image analysis");
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      const analysis = (await response.json()) as CandidateAnalysis;
      setAnalyses((current) => ({
        ...current,
        [candidate.id]: analysis,
      }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Image analysis failed",
      );
    } finally {
      setBusy(null);
    }
  }

  async function importCandidate(candidate: ArtworkCandidate) {
    setBusy(`import:${candidate.id}`);
    try {
      await waitForQueuedTask(
        await fetch(`${base}/assets/import-candidate`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate: candidate.id,
            label: candidate.label,
          }),
        }),
        "Candidate import failed",
      );
      await loadAssets();
      setCandidates((current) =>
        current.filter((item) => item.id !== candidate.id),
      );
      toast.success("Candidate added to the artist gallery");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Candidate import failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 border-t border-border-quiet pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <MonoLabel as="p" tone="accent">
            Curated source library
          </MonoLabel>
          <h3 className="mt-1 text-xl font-semibold text-foreground font-display">
            Artist image gallery
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Reuse the best images for {artistName} in any artwork slot without
            duplicating the original source.
          </p>
        </div>
        {canEdit ? (
          <ActionGroup label="Gallery actions">
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              aria-label="Add image to gallery"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <ActionButton
              label="Add image"
              disabled={uploading}
              loading={uploading}
              onClick={() => uploadRef.current?.click()}
            >
              <ImagePlus data-admin-ux="artwork-upload" aria-hidden="true" />
            </ActionButton>
            <ActionButton
              label="Find image candidates"
              disabled={discovering}
              loading={discovering}
              onClick={() => void discoverCandidates()}
            >
              <Search data-admin-ux="artwork-search" aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-5 flex min-h-40 items-center justify-center text-muted-foreground">
          <Loader2
            data-admin-ux="artwork-loading"
            className="h-5 w-5 animate-spin"
          />
        </div>
      ) : assets.length === 0 ? (
        <div className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface-object text-center">
          <p className="mt-3 text-sm font-medium text-foreground">
            No curated images yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload an image or import a trusted candidate.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {assets.map((asset) => (
            <article
              key={asset.id}
              className="overflow-hidden rounded-md border border-border-quiet bg-surface-object"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-surface-object">
                <img
                  src={asset.preview_url}
                  alt={asset.label}
                  className="h-full w-full object-cover"
                />
                {canEdit && asset.slots.length === 0 ? (
                  <div className="absolute right-2 top-2 z-10 rounded-md bg-surface-canvas">
                    <ActionButton
                      label={`Delete ${asset.label}`}
                      tooltip="Delete"
                      disabled={busy !== null}
                      loading={busy === `delete:${asset.id}`}
                      onClick={() => setAssetToDelete(asset)}
                    >
                      <Trash2
                        data-admin-ux="artwork-delete"
                        aria-hidden="true"
                      />
                    </ActionButton>
                  </div>
                ) : null}
              </div>
              <div className="space-y-3 p-3">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {asset.label}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {asset.width} × {asset.height}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {originLabel(asset.origin)}
                  </p>
                </div>
                {asset.slots.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {asset.slots.map((slot) => (
                      <Badge key={slot} variant="secondary">
                        {slotLabel(slot)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {canEdit ? (
                  <div className="grid grid-cols-2 gap-1.5 border-t border-border pt-3">
                    {SLOTS.map((slot) => (
                      <Button
                        key={slot.value}
                        size="sm"
                        variant="outline"
                        aria-label={`Use ${
                          asset.label
                        } as ${slot.label.toLowerCase()}`}
                        disabled={busy !== null}
                        onClick={() => void assign(asset, slot.value)}
                      >
                        {busy === `assign:${asset.id}:${slot.value}` ? (
                          <Loader2
                            data-admin-ux="artwork-upload-loading"
                            className="mr-1.5 h-3.5 w-3.5 animate-spin"
                          />
                        ) : null}
                        Use: {slot.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {candidates.length > 0 ? (
        <div className="mt-7 border-t border-border pt-5">
          <div>
            <h4 className="text-sm font-semibold text-foreground font-display">
              Available candidates
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Scores are deterministic. Visual analysis is optional and never
              changes an image automatically.
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((candidate) => {
              const analysis = analyses[candidate.id];
              return (
                <article
                  key={candidate.id}
                  className="overflow-hidden rounded-md border border-border-quiet bg-surface-object"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-surface-object">
                    <img
                      src={candidate.preview_url}
                      alt={`${candidate.label} candidate`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="space-y-3 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {candidate.label}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {originLabel(candidate.origin)} · {candidate.width} ×{" "}
                        {candidate.height}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        Desktop {candidate.desktop.score}
                      </Badge>
                      <Badge variant="outline">
                        Mobile {candidate.mobile.score}
                      </Badge>
                    </div>
                    {analysis ? (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
                        <p className="text-xs text-foreground">
                          {analysis.summary}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Vision: desktop {analysis.desktop.score} · mobile{" "}
                          {analysis.mobile.score}
                        </p>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-1.5">
                      <ActionButton
                        label={`Analyze ${candidate.label}`}
                        tooltip={
                          heroAI?.available
                            ? `Analyze with ${heroAI.model_id}`
                            : "Image analysis action unavailable"
                        }
                        disabled={busy !== null || !heroAI?.available}
                        loading={busy === `analyze:${candidate.id}`}
                        onClick={() => void analyze(candidate)}
                      >
                        <Bot
                          data-admin-ux="artwork-ai-generate"
                          aria-hidden="true"
                        />
                      </ActionButton>
                      <Button
                        size="sm"
                        aria-label={`Add ${candidate.label} to gallery`}
                        disabled={busy !== null}
                        onClick={() => void importCandidate(candidate)}
                      >
                        {busy === `import:${candidate.id}` ? (
                          <Loader2
                            data-admin-ux="artwork-ai-loading"
                            className="mr-1.5 h-3.5 w-3.5 animate-spin"
                          />
                        ) : null}
                        Add to gallery
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={assetToDelete !== null}
        onOpenChange={(open) => {
          if (!open && busy === null) setAssetToDelete(null);
        }}
        title={`Delete ${assetToDelete?.label ?? "image"}?`}
        description="This removes the image from the artist gallery. Assigned artwork slots are protected."
        confirmLabel="Delete image"
        tone="danger"
        onConfirm={async () => {
          if (assetToDelete) await deleteAsset(assetToDelete);
        }}
        onError={() => {}}
        eyebrow="Confirm action"
        consequence={`${
          assetToDelete?.label ?? "Image"
        } · removes the image from the artist gallery`}
      />
    </section>
  );
}
