import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ArtistHeroPresentation } from "@crate/ui/domain/ArtistHeroPresentation";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { Heart, Loader2, Play } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Slider } from "@crate/ui/primitives/Slider";
import { Switch } from "@crate/ui/primitives/Switch";
import { toast } from "sonner";

import {
  artistArtworkApiPath,
  artistBackgroundApiUrl,
  artistHeroApiUrl,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import type { ArtistHeroCompositionView } from "../../../../shared/web/artist-hero-contract";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";

import { HeroCompositionCanvas } from "./HeroCompositionCanvas";
import type { HeroRecipe } from "./hero-composition-geometry";

export type HeroComposition = "desktop" | "mobile";

export interface HeroArtworkReload {
  token: number;
  composition: HeroComposition;
}

interface HeroProfile {
  artist_id: number;
  provenance: "manual" | "derived_background";
  review_status: "approved" | "unreviewed" | "rejected";
  source_width: number;
  source_height: number;
  desktop_recipe: HeroRecipe;
  mobile_recipe: HeroRecipe;
  revision: string;
  updated_at: string;
  is_featured?: boolean;
  featured_devices?: HeroComposition[];
  desktop_enabled?: boolean;
  mobile_enabled?: boolean;
  compositions?: Partial<Record<HeroComposition, ArtistHeroCompositionView>>;
}

interface HeroPreviewArtifact {
  key: string;
  url: string;
  view?: ArtistHeroCompositionView;
}

interface ArtistHeroArtworkEditorProps {
  artistId: number;
  artistName: string;
  genres?: string[];
  canEdit: boolean;
  fallbackSourceUrl?: string | null;
  reload?: HeroArtworkReload | null;
  onUploaded?: () => void;
}

const DEFAULT_RECIPE: HeroRecipe = {
  mode: "crop",
  crop: { x: 0, y: 0, width: 1600, height: 1000 },
  position_x: 0.5,
  position_y: 0.5,
  scale: 1,
  flip_horizontal: false,
  rotation: 0,
  blur: 32,
  feather: 28,
  gradient: 0.45,
  grayscale: false,
  brightness: 1,
  contrast: 1,
};

function normalizeRecipe(recipe: HeroRecipe): HeroRecipe {
  return {
    ...recipe,
    grayscale: recipe.grayscale ?? false,
    brightness: recipe.brightness ?? 1,
    contrast: recipe.contrast ?? 1,
  };
}

function createRecipes(): Record<HeroComposition, HeroRecipe> {
  return {
    desktop: { ...DEFAULT_RECIPE, crop: { ...DEFAULT_RECIPE.crop } },
    mobile: { ...DEFAULT_RECIPE, crop: { ...DEFAULT_RECIPE.crop } },
  };
}

function createSourceState<T>(value: T): Record<HeroComposition, T> {
  return { desktop: value, mobile: value };
}

function provenanceLabel(profile: HeroProfile) {
  return profile.provenance === "manual"
    ? "Specific hero artwork"
    : "Derived from background";
}

function reviewLabel(profile: HeroProfile) {
  return `${profile.review_status
    .charAt(0)
    .toUpperCase()}${profile.review_status.slice(1)}`;
}

export function ArtistHeroArtworkEditor({
  artistId,
  artistName,
  genres = [],
  canEdit,
  fallbackSourceUrl,
  reload,
  onUploaded,
}: ArtistHeroArtworkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const profileRequestRef = useRef(0);
  const [profile, setProfile] = useState<HeroProfile | null>(null);
  const [sourceFiles, setSourceFiles] = useState<
    Record<HeroComposition, File | null>
  >(() => createSourceState<File | null>(null));
  const [sourceUrls, setSourceUrls] = useState<
    Record<HeroComposition, string | null>
  >(() => createSourceState<string | null>(null));
  const [active, setActive] = useState<HeroComposition>("desktop");
  const [recipes, setRecipes] =
    useState<Record<HeroComposition, HeroRecipe>>(createRecipes);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] =
    useState<HeroPreviewArtifact | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [featuredBusy, setFeaturedBusy] = useState(false);
  const [deleteComposition, setDeleteComposition] =
    useState<HeroComposition | null>(null);
  const profileEndpoint = artistArtworkApiPath({ artistId }, "hero-profile");

  const loadProfile = useCallback(
    async ({ preserveRecipes = false }: { preserveRecipes?: boolean } = {}) => {
      const requestId = ++profileRequestRef.current;
      const response = await fetch(profileEndpoint, {
        credentials: "include",
        cache: "no-store",
      });
      if (requestId !== profileRequestRef.current) return;
      if (!response.ok) {
        setProfile(null);
        return;
      }
      const responseProfile = (await response.json()) as HeroProfile;
      if (requestId !== profileRequestRef.current) return;
      const nextProfile: HeroProfile = {
        ...responseProfile,
        is_featured: responseProfile.is_featured ?? false,
        featured_devices: responseProfile.featured_devices ?? [],
      };
      const desktopRecipe = normalizeRecipe(nextProfile.desktop_recipe);
      const sharedTreatment = {
        grayscale: desktopRecipe.grayscale,
        brightness: desktopRecipe.brightness,
        contrast: desktopRecipe.contrast,
      };
      setProfile(nextProfile);
      if (preserveRecipes) return;
      setRecipes({
        desktop: desktopRecipe,
        mobile: {
          ...normalizeRecipe(nextProfile.mobile_recipe),
          ...sharedTreatment,
        },
      });
    },
    [profileEndpoint],
  );

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!reload) return;
    setActive(reload.composition);
    void loadProfile();
  }, [loadProfile, reload]);

  const recipe = recipes[active];
  const aspect = active === "desktop" ? 1480 / 600 : 4 / 5;
  const persistedRevision =
    profile?.compositions?.[active]?.render_revision ?? profile?.revision;
  const persistedPreview = artistHeroApiUrl({ artistId }, active, {
    size: active === "desktop" ? 1480 : 1080,
    version: persistedRevision,
  });
  const persistedSource = profile
    ? `${artistArtworkApiPath(
        { artistId },
        "hero-source",
      )}?composition=${active}&v=${encodeURIComponent(persistedRevision ?? "")}`
    : null;
  const activeCompositionEnabled =
    !profile || profile[`${active}_enabled`] !== false;
  const fallbackSource =
    fallbackSourceUrl ?? artistBackgroundApiUrl({ artistId }, { size: 1280 });
  const activeSource =
    sourceUrls[active] ??
    (activeCompositionEnabled ? persistedSource : null) ??
    fallbackSource;
  const previewKey = JSON.stringify({
    composition: active,
    recipe,
    source: sourceFiles[active]
      ? {
          name: sourceFiles[active]?.name,
          size: sourceFiles[active]?.size,
          lastModified: sourceFiles[active]?.lastModified,
        }
      : (profile?.revision ?? fallbackSource),
  });
  useEffect(() => {
    previewRequestRef.current += 1;
  }, [previewKey]);
  const canonicalPreviewView =
    previewArtifact?.key === previewKey
      ? previewArtifact.view
      : profile?.compositions?.[active];
  const treatment = {
    grayscale: recipes.desktop.grayscale ?? false,
    brightness: recipes.desktop.brightness ?? 1,
    contrast: recipes.desktop.contrast ?? 1,
  };

  function updateTreatment(
    patch: Partial<Pick<HeroRecipe, "grayscale" | "brightness" | "contrast">>,
  ) {
    setRecipes((current) => ({
      desktop: { ...current.desktop, ...patch },
      mobile: { ...current.mobile, ...patch },
    }));
  }

  function selectFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setSourceFiles((current) => ({ ...current, [active]: file }));
    const reader = new FileReader();
    reader.onload = () =>
      setSourceUrls((current) => ({
        ...current,
        [active]: String(reader.result),
      }));
    reader.readAsDataURL(file);
  }

  async function loadFallbackSourceFile() {
    if (!fallbackSource) return null;
    const response = await fetch(fallbackSource, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    return new File(
      [blob],
      `artist-background-${active}.${blob.type.split("/")[1] || "jpg"}`,
      { type: blob.type || "image/jpeg" },
    );
  }

  async function openPreview() {
    if (!canEdit) {
      setPreviewOpen(true);
      return;
    }

    const requestId = ++previewRequestRef.current;
    const requestKey = previewKey;
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const form = new FormData();
      form.append("recipe", JSON.stringify(recipe));
      form.append("composition", active);
      const sourceFile =
        sourceFiles[active] ??
        (!profile || !activeCompositionEnabled
          ? await loadFallbackSourceFile()
          : null);
      if (sourceFile) form.append("file", sourceFile);
      const response = await fetch(
        artistArtworkApiPath({ artistId }, "preview-hero"),
        { method: "POST", body: form, credentials: "include" },
      );
      if (!response.ok) throw new Error(await response.text());
      const queued = (await response.json()) as { task_id?: string };
      if (!queued.task_id) throw new Error("Hero preview task was not queued");
      const task = await waitForTask(queued.task_id, 120_000);
      if (task.status === "failed") {
        throw new Error(task.error || "Hero artwork preview failed");
      }
      const result = task.result ?? {};
      const previewUrl =
        typeof result.preview_url === "string" ? result.preview_url : null;
      if (!previewUrl)
        throw new Error("Hero preview did not return an artifact");
      if (requestId !== previewRequestRef.current) return;
      setPreviewArtifact({
        key: requestKey,
        url: previewUrl,
        view:
          result.view && typeof result.view === "object"
            ? (result.view as ArtistHeroCompositionView)
            : undefined,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Hero artwork preview failed",
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function generate() {
    if (!activeSource) return;
    setUploading(true);
    try {
      let response: Response;
      const sourceFile =
        sourceFiles[active] ??
        (!profile || !activeCompositionEnabled
          ? await loadFallbackSourceFile()
          : null);
      if (sourceFile) {
        const form = new FormData();
        form.append("file", sourceFile);
        form.append("desktop_recipe", JSON.stringify(recipes.desktop));
        form.append("mobile_recipe", JSON.stringify(recipes.mobile));
        form.append("composition", active);
        response = await fetch(
          artistArtworkApiPath({ artistId }, "upload-hero"),
          { method: "POST", body: form, credentials: "include" },
        );
      } else {
        response = await fetch(
          artistArtworkApiPath({ artistId }, "compose-hero"),
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              desktop_recipe: recipes.desktop,
              mobile_recipe: recipes.mobile,
              composition: active,
            }),
          },
        );
      }
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { task_id?: string };
      if (result.task_id) {
        const task = await waitForTask(result.task_id, 120_000);
        if (task.status === "failed") {
          throw new Error(task.error || "Hero artwork processing failed");
        }
      }
      await loadProfile({ preserveRecipes: true });
      setSourceFiles((current) => ({ ...current, [active]: null }));
      setSourceUrls((current) => ({ ...current, [active]: null }));
      toast.success("Hero artwork saved");
      onUploaded?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Hero artwork upload failed",
      );
    } finally {
      setUploading(false);
    }
  }

  async function deletePersistedComposition(composition: HeroComposition) {
    setProcessing(true);
    try {
      const response = await fetch(`${profileEndpoint}/${composition}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { task_id?: string };
      if (result.task_id) {
        const task = await waitForTask(result.task_id, 120_000);
        if (task.status === "failed") {
          throw new Error(task.error || "Hero composition deletion failed");
        }
      }
      setPreviewArtifact(null);
      setRecipes(createRecipes());
      setSourceFiles(createSourceState<File | null>(null));
      setSourceUrls(createSourceState<string | null>(null));
      await loadProfile();
      setRecipes((current) => ({
        ...current,
        [composition]: createRecipes()[composition],
      }));
      toast.success(`${composition} hero composition deleted`);
      onUploaded?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Hero composition deletion failed",
      );
      throw error;
    } finally {
      setProcessing(false);
    }
  }

  async function deriveFromBackground() {
    setProcessing(true);
    try {
      const response = await fetch(
        artistArtworkApiPath({ artistId }, "derive-hero"),
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { task_id?: string };
      if (result.task_id) {
        const task = await waitForTask(result.task_id, 120_000);
        if (task.status === "failed") {
          throw new Error(task.error || "Hero derivation failed");
        }
      }
      await loadProfile();
      toast.success("Hero artwork derived from background");
      onUploaded?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Hero derivation failed",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function review(review_status: "approved" | "rejected") {
    setProcessing(true);
    try {
      const response = await fetch(profileEndpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_status }),
      });
      if (!response.ok) throw new Error(await response.text());
      await loadProfile();
      toast.success(
        review_status === "approved"
          ? "Hero artwork approved"
          : "Hero artwork rejected",
      );
      onUploaded?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artwork review failed",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function setFeatured(next: boolean) {
    setFeaturedBusy(true);
    try {
      const response = await fetch(`/api/artists/${artistId}/featured`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_featured: next }),
      });
      if (!response.ok) {
        const raw = await response.text();
        let message = raw || "Featured Artist update failed";
        try {
          const payload = JSON.parse(raw) as { error?: string };
          if (payload.error === "approved_hero_required") {
            message = "Approve at least one hero composition first";
          }
        } catch {
          // Keep the server response when it is not JSON.
        }
        throw new Error(message);
      }
      await loadProfile({ preserveRecipes: true });
      toast.success(
        next ? "Artist marked as Featured" : "Artist removed from Featured",
      );
      onUploaded?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Featured Artist update failed",
      );
    } finally {
      setFeaturedBusy(false);
    }
  }

  return (
    <>
      <section className="space-y-4 border-t border-border-quiet pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <MonoLabel as="p" tone="accent">
              Featured artist hero
            </MonoLabel>
            <h2 className="mt-1 text-xl font-semibold text-foreground font-display">
              Desktop and mobile compositions
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Independent desktop and mobile sources, each with its own
              composition. Use Fill when the subject does not naturally fit the
              target ratio.
            </p>
          </div>
          {profile ? (
            <div className="flex flex-wrap justify-end gap-2">
              <div className="flex gap-2">
                <InfoBadge>{provenanceLabel(profile)}</InfoBadge>
                <InfoBadge>{reviewLabel(profile)}</InfoBadge>
                <InfoBadge
                  tone={
                    profile.featured_devices?.includes("desktop")
                      ? "neutral"
                      : "neutral"
                  }
                >
                  {profile.featured_devices?.includes("desktop")
                    ? "Desktop ready"
                    : "Desktop not ready"}
                </InfoBadge>
                <InfoBadge
                  tone={
                    profile.featured_devices?.includes("mobile")
                      ? "neutral"
                      : "neutral"
                  }
                >
                  {profile.featured_devices?.includes("mobile")
                    ? "Mobile ready"
                    : "Mobile not ready"}
                </InfoBadge>
              </div>
              {canEdit && profile.provenance === "derived_background" ? (
                <div className="flex gap-2">
                  {profile.review_status !== "rejected" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={processing}
                      onClick={() => void review("rejected")}
                    >
                      Reject
                    </Button>
                  ) : null}
                  {profile.review_status !== "approved" ? (
                    <Button
                      size="sm"
                      disabled={processing}
                      onClick={() => void review("approved")}
                    >
                      Approve
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {canEdit ? (
                <FormField
                  label="Featured artist"
                  hint={
                    profile.is_featured
                      ? "Shown in the home hero"
                      : "Enable after approving a composition"
                  }
                  layout="inline"
                >
                  <Switch
                    aria-label="Featured artist"
                    checked={profile.is_featured ?? false}
                    disabled={
                      featuredBusy ||
                      (!profile.is_featured &&
                        (profile.featured_devices?.length ?? 0) === 0)
                    }
                    onCheckedChange={(checked) => void setFeatured(checked)}
                  />
                </FormField>
              ) : null}
            </div>
          ) : (
            <InfoBadge>Background fallback</InfoBadge>
          )}
        </div>

        <SegmentedControl
          className="mt-5"
          label="Hero composition"
          as="tabs"
          value={active}
          onValueChange={setActive}
          items={(["desktop", "mobile"] as const).map((composition) => ({
            value: composition,
            label: `${composition} · ${composition === "desktop" ? "1480 × 600" : "1080 × 1350"}`,
          }))}
        />

        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <HeroCompositionCanvas
            sourceUrl={activeSource}
            previewUrl={persistedPreview}
            artistName={artistName}
            composition={active}
            aspect={aspect}
            recipe={recipe}
            editable={canEdit}
            onRecipeChange={(nextRecipe) =>
              setRecipes((current) => ({
                ...current,
                [active]: nextRecipe,
              }))
            }
          >
            <HeroPresentationOverlay
              artistName={artistName}
              composition={active}
              genres={genres}
            />
          </HeroCompositionCanvas>

          <div className="space-y-5">
            <div className="border-t border-border-quiet pt-4">
              <MonoLabel as="h3" tone="accent">
                Image treatment
              </MonoLabel>
              <FormField
                label="Grayscale"
                hint="Shared by desktop and mobile artwork."
                layout="inline"
                className="mt-3"
              >
                <Switch
                  aria-label="Grayscale"
                  checked={treatment.grayscale}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    updateTreatment({ grayscale: checked })
                  }
                />
              </FormField>

              <div className="mt-4 space-y-4">
                <TreatmentSlider
                  id="hero-brightness"
                  label="Brightness"
                  value={treatment.brightness}
                  disabled={!canEdit}
                  onChange={(brightness) => updateTreatment({ brightness })}
                />
                <TreatmentSlider
                  id="hero-contrast"
                  label="Contrast"
                  value={treatment.contrast}
                  disabled={!canEdit}
                  onChange={(contrast) => updateTreatment({ contrast })}
                />
              </div>
            </div>

            {canEdit ? (
              <>
                <input
                  ref={inputRef}
                  aria-label="Source image"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) selectFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => inputRef.current?.click()}
                >
                  {sourceFiles[active]
                    ? sourceFiles[active]?.name
                    : `Upload ${active} source`}
                </Button>

                {!profile || profile.provenance === "derived_background" ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={processing}
                    onClick={() => void deriveFromBackground()}
                  >
                    {processing ? (
                      <Loader2
                        data-admin-ux="hero-save-desktop-loading"
                        className="mr-2 h-4 w-4 animate-spin"
                      />
                    ) : null}
                    {profile
                      ? "Refresh from background"
                      : "Create from background"}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!activeSource}
                  onClick={() => void openPreview()}
                >
                  Preview result
                </Button>

                <Button
                  className="w-full"
                  disabled={!activeSource || uploading}
                  onClick={() => void generate()}
                >
                  {uploading ? (
                    <Loader2
                      data-admin-ux="hero-save-mobile-loading"
                      className="mr-2 h-4 w-4 animate-spin"
                    />
                  ) : null}
                  Generate hero artwork
                </Button>

                {profile && activeCompositionEnabled ? (
                  <Button
                    variant="outline"
                    className="w-full border-border-quiet/40 text-text-secondary hover:bg-surface-control/10 hover:text-text-secondary"
                    disabled={processing || uploading}
                    onClick={() => setDeleteComposition(active)}
                  >
                    Delete {active} composition
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  You can review the active compositions, but your role cannot
                  modify artwork.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!activeSource}
                  onClick={() => void openPreview()}
                >
                  Preview result
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <AppModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        size="3xl"
        panelClassName="sm:rounded-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <MonoLabel as="p" tone="accent">
              {artistName}
            </MonoLabel>
            <h2 className="mt-1 text-lg font-semibold text-foreground font-display">
              Preview hero artwork
            </h2>
          </div>
          <ModalCloseButton onClick={() => setPreviewOpen(false)} />
        </ModalHeader>

        <ModalBody className="max-h-[calc(92vh-9rem)] space-y-4 p-5 md:p-6">
          <SegmentedControl
            label="Preview composition"
            as="tabs"
            value={active}
            onValueChange={setActive}
            items={(["desktop", "mobile"] as const).map((composition) => ({
              value: composition,
              label: `${composition} · ${composition === "desktop" ? "1480 × 600" : "1080 × 1350"}`,
              ariaLabel: `Preview ${composition} composition`,
            }))}
          />

          {previewLoading ? (
            <div
              className="flex min-h-48 items-center justify-center rounded-md border border-border bg-surface-object text-sm text-muted-foreground"
              role="status"
            >
              <Loader2
                data-admin-ux="hero-preview-loading"
                className="mr-2 h-4 w-4 animate-spin"
              />
              Rendering canonical preview…
            </div>
          ) : (
            <HeroResultPreview
              sourceUrl={activeSource}
              previewUrl={
                previewArtifact?.key === previewKey
                  ? previewArtifact.url
                  : persistedPreview
              }
              previewArtworkBounds={canonicalPreviewView?.bounds}
              artistName={artistName}
              genres={genres}
              composition={active}
              aspect={aspect}
              recipe={recipe}
            />
          )}

          <p className="text-xs text-muted-foreground">
            This preview uses the current composition. Nothing is generated or
            saved until you confirm it in the editor.
          </p>
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" onClick={() => setPreviewOpen(false)}>
            Back to editor
          </Button>
        </ModalFooter>
      </AppModal>

      <ConfirmDialog
        open={deleteComposition !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteComposition(null);
        }}
        title={`Delete ${deleteComposition ?? ""} hero composition?`}
        description="This permanently removes the saved composition and its rendered artwork. You can create it again from a new source or the artist background."
        confirmLabel="Delete composition"
        tone="danger"
        onConfirm={async () => {
          if (deleteComposition)
            await deletePersistedComposition(deleteComposition);
        }}
        onError={() => {}}
        eyebrow="Confirm action"
        consequence={`${
          deleteComposition ?? ""
        } hero · permanently removes saved composition and rendered artwork`}
      />
    </>
  );
}

function TreatmentSlider({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <FormField id={id} label={label} hint={`${Math.round(value * 100)}%`}>
      <Slider
        id={id}
        aria-label={label}
        min="0.5"
        max="1.5"
        step="0.05"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </FormField>
  );
}

function HeroResultPreview({
  sourceUrl,
  previewUrl,
  previewArtworkBounds,
  artistName,
  genres,
  composition,
  aspect,
  recipe,
}: {
  sourceUrl: string | null;
  previewUrl?: string;
  previewArtworkBounds?: ArtistHeroCompositionView["bounds"];
  artistName: string;
  genres: string[];
  composition: HeroComposition;
  aspect: number;
  recipe: HeroRecipe;
}) {
  const mobile = composition === "mobile";

  return (
    <div
      data-testid={`${composition}-hero-result-preview`}
      className={mobile ? "mx-auto w-full max-w-[440px]" : "w-full"}
    >
      <HeroCompositionCanvas
        sourceUrl={sourceUrl}
        previewUrl={previewUrl}
        previewArtworkBounds={previewArtworkBounds}
        artistName={artistName}
        composition={composition}
        aspect={aspect}
        recipe={recipe}
        editable={false}
        previewOnly
        onRecipeChange={() => undefined}
      >
        <HeroPresentationOverlay
          artistName={artistName}
          composition={composition}
          genres={genres}
        />
      </HeroCompositionCanvas>
    </div>
  );
}

function HeroPresentationOverlay({
  artistName,
  composition,
  genres,
}: {
  artistName: string;
  composition: HeroComposition;
  genres: string[];
}) {
  const mobile = composition === "mobile";

  const actions = (
    <div className="mt-6 flex items-center gap-2.5">
      <span
        aria-label="Play artist"
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent-action font-semibold text-accent-action-foreground shadow-action-solid ${
          mobile ? "w-11 px-0" : "px-5"
        }`}
      >
        <Play data-admin-ux="hero-preview-play" size={17} fill="currentColor" />
        {mobile ? null : "Play artist"}
      </span>
      <span
        aria-label="Follow artist"
        className={`inline-flex h-11 w-11 items-center justify-center rounded-md text-text-primary/80 ${
          mobile
            ? "border border-border-control bg-surface-canvas-control backdrop-blur-md"
            : "border-0 bg-transparent backdrop-blur-0"
        }`}
      >
        <Heart data-admin-ux="hero-preview-follow" size={18} />
      </span>
    </div>
  );

  return (
    <div
      data-testid={`${composition}-hero-live-presentation`}
      className="pointer-events-none absolute inset-0 text-text-primary"
    >
      <ArtistHeroPresentation
        composition={composition}
        kicker="Just landed"
        artistName={artistName}
        genres={
          genres.length > 0 ? (
            <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
              {genres.slice(0, 2).map((name) => (
                <GenrePill
                  key={name}
                  item={{ name }}
                  className="max-w-[42vw] backdrop-blur-sm sm:max-w-none"
                />
              ))}
            </div>
          ) : null
        }
        intro={
          <div>
            <p className="text-3xl font-bold text-text-primary">
              Good afternoon
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Your music, ready to explore
            </p>
          </div>
        }
        actions={actions}
      />
    </div>
  );
}
