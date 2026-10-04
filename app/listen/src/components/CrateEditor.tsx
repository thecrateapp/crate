import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
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
import { notify } from "@crate/ui/lib/notify";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { IconButton } from "@crate/ui/primitives/IconButton";
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
        size="xl"
        title={t("library.crates.title")}
        closeLabel={t("common.close")}
        headerClassName="bg-transparent"
        panelClassName="listen-glass-panel flex flex-col border-border-quiet"
      >
        <section className="flex min-h-0 flex-col">
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
                  size={CRATE_ICON_SIZE.xl}
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
  const [deleting, setDeleting] = useState(false);
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
      notify.success(t("library.crates.saved"));
      onBack();
    } catch {
      notify.error(t("library.crates.saveFailed"));
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
      notify.success(t("library.crates.albumAdded"));
    } catch (error) {
      notify.error(
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
      notify.error(t("library.crates.albumRemoveFailed"));
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
      notify.error(t("library.crates.reorderFailed"));
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
    setDeleting(true);
    try {
      await api(`/api/crates/${crate.id}`, "DELETE");
      notify.success(t("library.crates.deleted"));
      onDeleted();
    } catch {
      notify.error(t("library.crates.deleteFailed"));
      setDeleting(false);
    }
  }

  const existingAlbumUids = new Set(
    albums.map((album) => album.global_album_uid),
  );

  return (
    <AppModal
      open
      onClose={onBack}
      size="xl"
      title={<span className="block truncate">{crate.name}</span>}
      closeLabel={t("common.close")}
      closeOnEscape={!deleteConfirmation}
      headerClassName="bg-transparent"
      panelClassName="listen-glass-panel flex flex-col border-border-quiet"
    >
      <section className="flex min-h-0 flex-col">
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
              <Button
                variant="ghost"
                onClick={() => setDeleteConfirmation(true)}
                className="text-state-danger hover:text-state-danger"
              >
                <Trash2 size={CRATE_ICON_SIZE.sm} />
                {t("library.crates.delete")}
              </Button>
              <ConfirmDialog
                open={deleteConfirmation}
                tone="danger"
                pending={deleting}
                title={t("library.crates.delete")}
                body={t("library.crates.deleteConfirmation", {
                  name: crate.name,
                })}
                confirmLabel={t("library.crates.confirmDelete")}
                cancelLabel={t("common.cancel")}
                closeLabel={t("common.close")}
                onCancel={() => setDeleteConfirmation(false)}
                onConfirm={() => void deleteCrate()}
              />
            </section>
          )}
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <Button variant="ghost" onClick={onBack}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={EDITOR_FORM_ID}
            loading={saving}
            disabled={!isCrateFormValid(values)}
          >
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
        <IconButton
          {...sortable.attributes}
          {...sortable.listeners}
          label={t("library.crates.dragAlbum", { name: album.name })}
          size="sm"
          className="size-6 cursor-grab touch-none text-text-muted/60 hover:translate-y-0 hover:text-text-primary hover:drop-shadow-none active:cursor-grabbing"
        >
          <GripVertical size={CRATE_ICON_SIZE.sm} />
        </IconButton>
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
            <Disc3 size={CRATE_ICON_SIZE.lg} />
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
            <IconButton
              label={t("library.crates.moveAlbumUp", { name: album.name })}
              className="size-9 disabled:opacity-25"
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
            >
              <ChevronUp size={CRATE_ICON_SIZE.md} />
            </IconButton>
            <IconButton
              label={t("library.crates.moveAlbumDown", { name: album.name })}
              className="size-9 disabled:opacity-25"
              disabled={index === total - 1}
              onClick={() => onMove(index, 1)}
            >
              <ChevronDown size={CRATE_ICON_SIZE.md} />
            </IconButton>
          </>
        ) : null}
        <IconButton
          label={t("library.crates.removeAlbum", { name: album.name })}
          size="sm"
          className="size-9 hover:text-state-danger hover:drop-shadow-none"
          onClick={onRemove}
        >
          <Trash2 size={CRATE_ICON_SIZE.sm} />
        </IconButton>
      </div>
    </li>
  );
}
