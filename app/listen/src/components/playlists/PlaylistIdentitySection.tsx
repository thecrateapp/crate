import { type ChangeEvent, type Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, ImagePlus, Upload } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import type {
  PlaylistComposerAction,
  PlaylistComposerState,
} from "@/components/playlists/playlist-composer-model";
import { cn } from "@/lib/utils";

const FIELD_LABEL_CLASS_NAME =
  "text-xs font-medium uppercase tracking-[0.18em] text-text-primary/40";

type PlaylistIdentityState = Pick<
  PlaylistComposerState,
  | "name"
  | "description"
  | "coverDataUrl"
  | "visibility"
  | "isCollaborative"
  | "tracks"
  | "titleEditing"
  | "descriptionEditing"
>;

export function PlaylistIdentitySection({
  state,
  refs,
  dispatch,
  handleFileChange,
  t,
}: {
  state: PlaylistIdentityState;
  refs: {
    fileInputRef: { current: HTMLInputElement | null };
    titleInputRef: { current: HTMLInputElement | null };
    descriptionInputRef: { current: HTMLTextAreaElement | null };
  };
  dispatch: Dispatch<PlaylistComposerAction>;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const {
    name,
    description,
    coverDataUrl,
    visibility,
    isCollaborative,
    tracks,
    titleEditing,
    descriptionEditing,
  } = state;
  const { fileInputRef, titleInputRef, descriptionInputRef } = refs;

  return (
    <div className="flex items-start gap-4">
      <div className="flex w-24 shrink-0 flex-col gap-2 sm:w-28">
        <PlaylistArtwork
          name={name || t("playlistComposer.newPlaylist")}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="size-24 rounded-xl shadow-2xl sm:size-28"
        />
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1 rounded-full bg-text-primary/5 px-2 py-1.5 text-center text-xs font-medium leading-4 text-text-primary outline-none transition-colors hover:bg-text-primary/10 focus-visible:shadow-focus"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={CRATE_ICON_SIZE.micro} className="shrink-0" />
          {t("playlistComposer.editCover")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <FormField
          className="gap-1"
          label={t("playlistComposer.playlistLabel")}
          labelClassName={FIELD_LABEL_CLASS_NAME}
        >
          {(control) =>
            titleEditing ? (
              <Input
                {...control}
                ref={titleInputRef}
                type="text"
                placeholder={t("playlistComposer.namePlaceholder")}
                value={name}
                onChange={(event) =>
                  dispatch({ type: "set-name", value: event.target.value })
                }
                onBlur={() =>
                  dispatch({ type: "set-title-editing", value: false })
                }
                className="h-auto rounded-lg bg-text-primary/5 px-3 py-2.5 text-xl font-semibold placeholder:text-text-muted md:text-xl"
              />
            ) : (
              <button
                type="button"
                className="w-full text-left text-xl font-semibold text-text-primary transition-colors hover:text-text-primary"
                onClick={() =>
                  dispatch({ type: "set-title-editing", value: true })
                }
              >
                {name || t("playlistComposer.addTitle")}
              </button>
            )
          }
        </FormField>

        <FormField
          className="gap-1"
          label={t("playlistComposer.descriptionLabel")}
          labelClassName={FIELD_LABEL_CLASS_NAME}
        >
          {(control) =>
            descriptionEditing ? (
              <Textarea
                {...control}
                ref={descriptionInputRef}
                rows={3}
                placeholder={t("playlistComposer.descriptionPlaceholder")}
                value={description}
                onChange={(event) =>
                  dispatch({
                    type: "set-description",
                    value: event.target.value,
                  })
                }
                onBlur={() =>
                  dispatch({
                    type: "set-description-editing",
                    value: false,
                  })
                }
                className="min-h-0 resize-none rounded-lg bg-text-primary/5 px-3 py-2.5 placeholder:text-text-muted md:text-base"
              />
            ) : (
              <button
                type="button"
                className="w-full text-left text-sm leading-6 text-text-muted transition-colors hover:text-text-primary"
                onClick={() =>
                  dispatch({
                    type: "set-description-editing",
                    value: true,
                  })
                }
              >
                {description || t("playlistComposer.addDescription")}
              </button>
            )
          }
        </FormField>

        {coverDataUrl ? (
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => dispatch({ type: "set-cover", value: null })}
          >
            <ImagePlus size={CRATE_ICON_SIZE.xs} />
            {t("playlistComposer.useCollage")}
          </Button>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SegmentedControl
            as="radio"
            size="sm"
            label={t("library.crates.visibility")}
            value={visibility}
            onValueChange={(value) =>
              dispatch({ type: "set-visibility", value })
            }
            items={[
              { value: "private", label: t("playlist.visibility.private") },
              { value: "public", label: t("playlist.visibility.public") },
            ]}
          />
          <button
            type="button"
            aria-pressed={isCollaborative}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:shadow-focus",
              isCollaborative
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted",
            )}
            onClick={() => dispatch({ type: "toggle-collaborative" })}
          >
            {t("playlist.badges.collaborative")}
          </button>
        </div>
      </div>
    </div>
  );
}
