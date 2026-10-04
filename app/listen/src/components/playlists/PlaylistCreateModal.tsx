import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { type DragEndEvent } from "@dnd-kit/core";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";
import { api } from "@/lib/api";
import {
  fileToDataUrl,
  getTrackKey,
  initialPlaylistComposerState,
  playlistComposerReducer,
  toComposerTrack,
  type PlaylistComposerTrack,
  type SearchTrackResult,
} from "@/components/playlists/playlist-composer-model";
export type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";

import {
  PlaylistIdentitySection,
  PlaylistTrackList,
  PlaylistTrackSearch,
} from "@/components/playlists/PlaylistComposerSections";

interface PlaylistCreateModalProps {
  open: boolean;
  mode?: "create" | "edit";
  initialName?: string;
  initialDescription?: string;
  initialCoverDataUrl?: string | null;
  initialVisibility?: "public" | "private";
  initialCollaborative?: boolean;
  initialTracks: PlaylistComposerTrack[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) => Promise<void>;
}

export function PlaylistCreateModal({
  open,
  mode = "create",
  initialName = "",
  initialDescription = "",
  initialCoverDataUrl = null,
  initialVisibility = "private",
  initialCollaborative = false,
  initialTracks,
  submitting,
  onClose,
  onSubmit,
}: PlaylistCreateModalProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    playlistComposerReducer,
    initialPlaylistComposerState,
  );
  const {
    name,
    description,
    coverDataUrl,
    visibility,
    isCollaborative,
    tracks,
    search,
    searching,
    results,
    titleEditing,
    descriptionEditing,
  } = state;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    dispatch({
      type: "reset",
      initialName,
      initialDescription,
      initialCoverDataUrl,
      initialVisibility,
      initialCollaborative,
      initialTracks,
    });
  }, [
    initialCollaborative,
    initialCoverDataUrl,
    initialDescription,
    initialName,
    initialTracks,
    initialVisibility,
    open,
  ]);

  useEffect(() => {
    if (!open || !titleEditing) return;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, titleEditing]);

  useEffect(() => {
    if (!open || !descriptionEditing) return;
    const timer = window.setTimeout(
      () => descriptionInputRef.current?.focus(),
      30,
    );
    return () => window.clearTimeout(timer);
  }, [descriptionEditing, open]);

  useEffect(() => {
    if (!open) return undefined;
    const query = search.trim();
    if (query.length < 2) {
      dispatch({ type: "set-results", value: [] });
      dispatch({ type: "set-searching", value: false });
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      dispatch({ type: "set-searching", value: true });
      try {
        const response = await api<{ tracks: SearchTrackResult[] }>(
          `/api/catalog/search?q=${encodeURIComponent(query)}&limit=20`,
        );
        if (!cancelled) {
          dispatch({ type: "set-results", value: response.tracks || [] });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "set-results", value: [] });
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "set-searching", value: false });
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    dispatch({
      type: "move-track",
      activeId: String(active.id),
      overId: String(over.id),
    });
  }, []);

  if (!open) return null;

  const isEditMode = mode === "edit";
  const modalTitle = isEditMode
    ? t("playlistComposer.editTitle")
    : t("playlistComposer.createTitle");
  const modalSubtitle = isEditMode
    ? t("playlistComposer.editSubtitle")
    : t("playlistComposer.createSubtitle");
  const submitLabel = isEditMode
    ? t("playlistComposer.saveChanges")
    : t("playlistComposer.createPlaylist");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      dispatch({ type: "set-cover", value: dataUrl });
    } catch {
      dispatch({ type: "set-cover", value: null });
    } finally {
      event.target.value = "";
    }
  }

  function addTrack(track: PlaylistComposerTrack) {
    dispatch({ type: "add-track", value: track });
  }

  function removeTrack(track: PlaylistComposerTrack) {
    dispatch({ type: "remove-track", key: getTrackKey(track) });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    await onSubmit({
      name: trimmedName,
      description: description.trim(),
      coverDataUrl,
      visibility,
      isCollaborative,
      tracks,
    });
  }

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={modalTitle}
      description={modalSubtitle}
      closeLabel={t("common.close")}
      closeDisabled={submitting}
      headerClassName="bg-transparent"
      maxWidthClassName="sm:max-w-3xl"
      panelClassName="listen-glass-panel flex flex-col border-border-quiet"
      closeOnEscape={!submitting}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
        <ModalBody className="space-y-5 p-5 ">
          <PlaylistIdentitySection
            state={{
              name,
              description,
              coverDataUrl,
              visibility,
              isCollaborative,
              tracks,
              titleEditing,
              descriptionEditing,
            }}
            refs={{
              fileInputRef,
              titleInputRef,
              descriptionInputRef,
            }}
            dispatch={dispatch}
            handleFileChange={handleFileChange}
            t={t}
          />

          <PlaylistTrackSearch
            search={search}
            searching={searching}
            results={results}
            t={t}
            onSearchChange={(value) => dispatch({ type: "set-search", value })}
            onAddTrack={(track) => addTrack(toComposerTrack(track))}
          />

          <PlaylistTrackList
            tracks={tracks}
            t={t}
            onDragEnd={handleDragEnd}
            onRemove={removeTrack}
          />
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <Button
            variant="ghost"
            className="rounded-lg"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            className="rounded-lg"
            loading={submitting}
            disabled={!name.trim()}
          >
            {submitLabel}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
