import { type ChangeEvent, type Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, ImagePlus, Upload } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { Switch } from "@crate/ui/primitives/Switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import type {
  PlaylistComposerAction,
  PlaylistComposerState,
} from "@/components/playlists/playlist-composer-model";

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
  canManageSettings = true,
  t,
}: {
  canManageSettings?: boolean;
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
          className="size-24 sm:size-28"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
          {t("playlistComposer.editCover")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <FormField label={t("playlistComposer.playlistLabel")}>
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
              />
            ) : (
              <button
                {...control}
                type="button"
                data-slot="form-field-value"
                className="min-h-10 w-full text-left pointer-coarse:min-h-11"
                onClick={() =>
                  dispatch({ type: "set-title-editing", value: true })
                }
              >
                {name || t("playlistComposer.addTitle")}
              </button>
            )
          }
        </FormField>

        <FormField label={t("playlistComposer.descriptionLabel")}>
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
              />
            ) : (
              <button
                {...control}
                type="button"
                data-slot="form-field-value"
                className="min-h-10 w-full text-left pointer-coarse:min-h-11"
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
            onClick={() => dispatch({ type: "set-cover", value: null })}
          >
            <ImagePlus size={CRATE_ICON_SIZE.xs} />
            {t("playlistComposer.useCollage")}
          </Button>
        ) : null}

        {canManageSettings ? (
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <FormField label={t("library.crates.visibility")}>
              {(control) => (
                <Select
                  value={visibility}
                  onValueChange={(value) =>
                    dispatch({
                      type: "set-visibility",
                      value: value as "private" | "public",
                    })
                  }
                >
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="private">
                      {t("playlist.visibility.private")}
                    </SelectItem>
                    <SelectItem value="public">
                      {t("playlist.visibility.public")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              label={t("playlist.badges.collaborative")}
              layout="inline"
            >
              <Switch
                checked={isCollaborative}
                onCheckedChange={() =>
                  dispatch({ type: "toggle-collaborative" })
                }
              />
            </FormField>
          </div>
        ) : null}
      </div>
    </div>
  );
}
