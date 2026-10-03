import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Disc3,
  GripVertical,
  Loader2,
  Trash2,
} from "@crate/ui/icons";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateAlbumPicker } from "@/components/CrateAlbumPicker";
import {
  CrateForm,
  crateFormPayload,
  crateFormValuesFromCrate,
  isCrateFormValid,
  type CrateFormValues,
} from "@/components/crates/CrateForm";
import type {
  CatalogAlbum,
  CrateAlbum,
  CrateDetail,
} from "@/pages/crates-types";

interface CrateEditorProps {
  crateId: string;
  onBack: () => void;
  onDeleted: () => void;
}

const EDITOR_FORM_ID = "crate-editor-form";

export function CrateEditor({ crateId, onBack, onDeleted }: CrateEditorProps) {
  const { t } = useTranslation();
  const {
    data: crate,
    loading,
    error,
  } = useApi<CrateDetail>(`/api/crates/${crateId}`);

  if (loading || !crate) {
    return (
      <AppModal
        open
        onClose={onBack}
        maxWidthClassName="sm:max-w-4xl"
        panelClassName="listen-glass-panel border-border-quiet"
      >
        <section className="flex max-h-[92vh] flex-col">
          <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.crates.title")}
            </h2>
            <ModalCloseButton onClick={onBack} />
          </ModalHeader>
          <ModalBody className="p-5">
            {error ? (
              <p
                role="alert"
                className="py-12 text-center text-sm text-state-danger"
              >
                {t("library.crates.loadFailed")}
              </p>
            ) : (
              <div className="flex justify-center py-12">
                <Loader2
                  size={24}
                  className="animate-spin text-accent-action"
                />
              </div>
            )}
          </ModalBody>
        </section>
      </AppModal>
    );
  }

  return (
    <CrateEditorForm
      key={crate.id}
      crate={crate}
      onBack={onBack}
      onDeleted={onDeleted}
    />
  );
}

function CrateEditorForm({
  crate,
  onBack,
  onDeleted,
}: {
  crate: CrateDetail;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const isOwner = crate.access === "owner";
  const [values, setValues] = useState<CrateFormValues>(() =>
    crateFormValuesFromCrate(crate),
  );
  const [albums, setAlbums] = useState<CrateAlbum[]>(crate.albums);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const isOrdered = values.ordering !== "none";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCrateFormValid(values)) return;

    setSaving(true);
    try {
      await api(
        `/api/crates/${crate.id}`,
        "PUT",
        crateFormPayload(values, isOwner),
      );
      toast.success(t("library.crates.saved"));
      onBack();
    } catch {
      toast.error(t("library.crates.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function addAlbum(album: CatalogAlbum) {
    const uid =
      album.global_album_uid ?? album.entity_uid ?? album.album_entity_uid;
    if (!uid) return;
    try {
      const added = await api<CrateAlbum>(
        `/api/crates/${crate.id}/albums`,
        "POST",
        { global_album_uid: uid },
      );
      setAlbums((current) => [...current, added]);
      toast.success(t("library.crates.albumAdded"));
    } catch (error) {
      toast.error(
        (error as { status?: number }).status === 409
          ? t("library.crates.albumAlreadyInCrate", { name: crate.name })
          : t("library.crates.albumAddFailed"),
      );
    }
  }

  async function removeAlbum(album: CrateAlbum) {
    try {
      await api(
        `/api/crates/${crate.id}/albums/${encodeURIComponent(
          album.global_album_uid,
        )}`,
        "DELETE",
      );
      setAlbums((current) =>
        current.filter(
          (item) => item.global_album_uid !== album.global_album_uid,
        ),
      );
    } catch {
      toast.error(t("library.crates.albumRemoveFailed"));
    }
  }

  async function reorderAlbums(fromIndex: number, targetIndex: number) {
    if (
      fromIndex < 0 ||
      targetIndex < 0 ||
      fromIndex >= albums.length ||
      targetIndex >= albums.length ||
      fromIndex === targetIndex
    ) {
      return;
    }

    const reordered = [...albums];
    const [movedAlbum] = reordered.splice(fromIndex, 1);
    if (!movedAlbum) return;
    reordered.splice(targetIndex, 0, movedAlbum);

    try {
      await api(`/api/crates/${crate.id}/albums/order`, "PUT", {
        global_album_uids: reordered.map((album) => album.global_album_uid),
      });
      setAlbums(reordered.map((album, position) => ({ ...album, position })));
    } catch {
      toast.error(t("library.crates.reorderFailed"));
    }
  }

  function moveAlbum(index: number, direction: -1 | 1) {
    void reorderAlbums(index, index + direction);
  }

  function handleAlbumDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const fromIndex = albums.findIndex(
      (album) => album.global_album_uid === String(active.id),
    );
    const targetIndex = albums.findIndex(
      (album) => album.global_album_uid === String(over.id),
    );
    void reorderAlbums(fromIndex, targetIndex);
  }

  async function deleteCrate() {
    try {
      await api(`/api/crates/${crate.id}`, "DELETE");
      toast.success(t("library.crates.deleted"));
      onDeleted();
    } catch {
      toast.error(t("library.crates.deleteFailed"));
    }
  }

  const existingAlbumUids = new Set(
    albums.map((album) => album.global_album_uid),
  );

  return (
    <AppModal
      open
      onClose={onBack}
      maxWidthClassName="sm:max-w-4xl"
      panelClassName="listen-glass-panel border-border-quiet"
    >
      <section className="flex max-h-[92vh] flex-col">
        <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
          <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">
            {crate.name}
          </h2>
          <ModalCloseButton onClick={onBack} />
        </ModalHeader>
        <ModalBody className="space-y-5 p-5">
          <CrateForm
            id={EDITOR_FORM_ID}
            values={values}
            isOwner={isOwner}
            onChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
            onSubmit={(event) => void save(event)}
          />

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-text-primary">
                {t("library.crates.albums")}
              </h2>
              <span className="text-sm text-text-muted">
                {t("common.albumCountLabel", { count: albums.length })}
              </span>
            </div>
            {albums.length > 0 ? (
              <ol className="divide-y divide-text-primary/6 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/[0.025]">
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={handleAlbumDragEnd}
                >
                  <SortableContext
                    items={albums.map((album) => album.global_album_uid)}
                    strategy={verticalListSortingStrategy}
                  >
                    {albums.map((album, index) => (
                      <SortableCrateAlbumRow
                        key={album.global_album_uid}
                        album={album}
                        index={index}
                        total={albums.length}
                        reorderable={isOrdered}
                        onMove={moveAlbum}
                        onRemove={() => void removeAlbum(album)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </ol>
            ) : (
              <div className="rounded-xl border border-dashed border-border-quiet px-4 py-8 text-center text-sm text-text-muted">
                {t("library.crates.noAlbums")}
              </div>
            )}
            <CrateAlbumPicker
              existingAlbumUids={existingAlbumUids}
              onAdd={addAlbum}
            />
          </section>

          {isOwner && (
            <section className="border-t border-border-quiet pt-5">
              {deleteConfirmation ? (
                <div className="space-y-3 rounded-xl border border-state-danger/20 bg-state-danger/5 p-4">
                  <p className="text-sm text-text-primary">
                    {t("library.crates.deleteConfirmation", {
                      name: crate.name,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void deleteCrate()}
                    >
                      {t("library.crates.confirmDelete")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDeleteConfirmation(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDeleteConfirmation(true)}
                  className="text-state-danger hover:text-state-danger"
                >
                  <Trash2 size={15} />
                  {t("library.crates.delete")}
                </Button>
              )}
            </section>
          )}
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={EDITOR_FORM_ID}
            disabled={saving || !isCrateFormValid(values)}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </ModalFooter>
      </section>
    </AppModal>
  );
}

function SortableCrateAlbumRow(props: CrateAlbumRowProps) {
  const sortable = useSortable({ id: props.album.global_album_uid });
  return <CrateAlbumRow {...props} sortable={sortable} />;
}

interface CrateAlbumRowProps {
  album: CrateAlbum;
  index: number;
  total: number;
  reorderable: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
}

function CrateAlbumRow({
  album,
  index,
  total,
  reorderable,
  onMove,
  onRemove,
  sortable,
}: CrateAlbumRowProps & {
  sortable: ReturnType<typeof useSortable>;
}) {
  const { t } = useTranslation();
  const cover = albumCoverApiUrl(
    {
      globalAlbumUid: album.global_album_uid,
      albumName: album.name,
      artistName: album.artist_name,
    },
    { size: 128 },
  );

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.55 : 1,
  };

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5"
    >
      {reorderable ? (
        <button
          type="button"
          aria-label={t("library.crates.dragAlbum", { name: album.name })}
          title={t("library.crates.dragAlbum", { name: album.name })}
          className="shrink-0 touch-none cursor-grab text-text-muted/60 hover:text-text-primary active:cursor-grabbing"
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={16} />
        </button>
      ) : null}
      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-text-primary/5">
        {album.has_cover ? (
          <CrateImage
            src={cover}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-text-primary/30">
            <Disc3 size={20} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">
          {album.name}
        </p>
        <p className="truncate text-xs text-text-muted">
          {album.artist_name}
          {album.year ? ` · ${album.year}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {reorderable ? (
          <>
            <button
              type="button"
              aria-label={t("library.crates.moveAlbumUp", { name: album.name })}
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
              className="flex size-9 items-center justify-center rounded-full text-text-muted hover:bg-text-primary/8 hover:text-text-primary disabled:opacity-25"
            >
              <ChevronUp size={17} />
            </button>
            <button
              type="button"
              aria-label={t("library.crates.moveAlbumDown", {
                name: album.name,
              })}
              disabled={index === total - 1}
              onClick={() => onMove(index, 1)}
              className="flex size-9 items-center justify-center rounded-full text-text-muted hover:bg-text-primary/8 hover:text-text-primary disabled:opacity-25"
            >
              <ChevronDown size={17} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          aria-label={t("library.crates.removeAlbum", { name: album.name })}
          onClick={onRemove}
          className="flex size-9 items-center justify-center rounded-full text-text-muted hover:bg-text-primary/8 hover:text-state-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
