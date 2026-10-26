import { CollectionEditorItemRow } from "./collections/CollectionEditorItemRow";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { CollectionEditorDialog } from "./collections/CollectionEditorDialog";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  ChevronDown,
  ChevronUp,
  Disc3,
  GripVertical,
  Trash2,
} from "@crate/ui/icons";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { notify } from "@crate/ui/lib/notify";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { Button } from "@crate/ui/shadcn/button";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache";
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

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

export function CrateEditor({ crateId, onBack, onDeleted }: CrateEditorProps) {
  const { t } = useTranslation();
  const {
    data: crate,
    loading,
    error,
    refetch,
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
      >
        <section className="flex min-h-0 flex-col">
          <ModalBody className="p-5">
            {error ? (
              <ErrorState
                message={t("library.crates.loadFailed")}
                retryLabel={t("common.retry")}
                onRetry={refetch}
              />
            ) : (
              <LoadingState label={t("common.loadingShort")} />
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
  const [valuesEdited, setValuesEdited] = useState(false);
  const [albums, setAlbums] = useState<CrateAlbum[]>(crate.albums);
  const [syncedCrate, setSyncedCrate] = useState(crate);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draggingAlbumUid, setDraggingAlbumUid] = useState<string | null>(null);
  const isOrdered = values.ordering !== "none";

  if (crate !== syncedCrate) {
    setSyncedCrate(crate);
    setAlbums(crate.albums);
    if (!valuesEdited) setValues(crateFormValuesFromCrate(crate));
  }

  useEffect(() => {
    if (draggingAlbumUid === null) return undefined;
    const keepModalOpenOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", keepModalOpenOnEscape, true);
    return () =>
      window.removeEventListener("keydown", keepModalOpenOnEscape, true);
  }, [draggingAlbumUid]);
  const albumSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
      cacheInvalidate("crates");
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
    setDraggingAlbumUid(null);
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

  const draggingAlbum = albums.find(
    (album) => album.global_album_uid === draggingAlbumUid,
  );
  const existingAlbumUids = new Set(
    albums.map((album) => album.global_album_uid),
  );

  return (
    <CollectionEditorDialog
      open
      title={crate.name}
      size="xl"
      formId={EDITOR_FORM_ID}
      submitLabel={t("common.save")}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      pending={saving || deleting}
      closeBlocked={deleteConfirmation}
      submitDisabled={!isCrateFormValid(values)}
      onCancel={onBack}
    >
      <CrateForm
        id={EDITOR_FORM_ID}
        values={values}
        isOwner={isOwner}
        onChange={(patch) => {
          setValuesEdited(true);
          setValues((current) => ({ ...current, ...patch }));
        }}
        onSubmit={(event) => void save(event)}
      />

      <section className="space-y-3">
        <SectionHeader
          title={t("library.crates.albums")}
          action={
            <MonoLabel>
              {t("common.albumCountLabel", { count: albums.length })}
            </MonoLabel>
          }
        />
        {albums.length > 0 ? (
          <ol className="divide-y divide-text-primary/6 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/[0.025]">
            <DndContext
              sensors={albumSensors}
              collisionDetection={closestCenter}
              onDragStart={({ active }) =>
                setDraggingAlbumUid(String(active.id))
              }
              onDragEnd={handleAlbumDragEnd}
              onDragCancel={() => setDraggingAlbumUid(null)}
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
              {createPortal(
                <div className="relative z-app-drag-overlay">
                  <DragOverlay
                    wrapperElement="ol"
                    modifiers={[restrictToVerticalAxis]}
                    className="overflow-hidden rounded-xl border border-border-quiet bg-surface-popover shadow-popover"
                  >
                    {draggingAlbum ? (
                      <CrateAlbumRow
                        album={draggingAlbum}
                        index={albums.indexOf(draggingAlbum)}
                        total={albums.length}
                        reorderable={isOrdered}
                        onMove={moveAlbum}
                        onRemove={() => undefined}
                      />
                    ) : null}
                  </DragOverlay>
                </div>,
                document.body,
              )}
            </DndContext>
          </ol>
        ) : (
          <EmptyState message={t("library.crates.noAlbums")} />
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
            eyebrow={t("actions.confirmation.eyebrow")}
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
    </CollectionEditorDialog>
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
  sortable?: ReturnType<typeof useSortable>;
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

  const style = sortable
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.55 : 1,
      }
    : undefined;

  return (
    <li
      ref={sortable?.setNodeRef}
      style={style}
      inert={sortable ? undefined : true}
    >
      <CollectionEditorItemRow
        title={album.name}
        subtitle={album.artist_name}
        meta={
          album.year ? <MonoLabel as="span">{album.year}</MonoLabel> : undefined
        }
        artwork={
          <MediaCover
            src={album.has_cover ? cover : undefined}
            alt=""
            size={48}
            fallbackIcon={Disc3}
            renderImage={(image) => (
              <CrateImage
                src={image.src}
                alt=""
                loading="lazy"
                className={image.className}
              />
            )}
          />
        }
        dragHandle={
          reorderable ? (
            <Button
              {...sortable?.attributes}
              {...sortable?.listeners}
              variant="ghost"
              size="icon-lg"
              aria-label={t("library.crates.dragAlbum", { name: album.name })}
              title={t("library.crates.ordering")}
              className="cursor-grab touch-none"
            >
              <GripVertical size={CRATE_ICON_SIZE.md} />
            </Button>
          ) : undefined
        }
        reorderControls={
          reorderable ? (
            <ActionGroup label={t("library.crates.ordering")}>
              <ActionButton
                label={t("library.crates.moveAlbumUp", { name: album.name })}
                tooltip={t("library.crates.ascending")}
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
              >
                <ChevronUp size={CRATE_ICON_SIZE.md} />
              </ActionButton>
              <ActionButton
                label={t("library.crates.moveAlbumDown", { name: album.name })}
                tooltip={t("library.crates.descending")}
                disabled={index === total - 1}
                onClick={() => onMove(index, 1)}
              >
                <ChevronDown size={CRATE_ICON_SIZE.md} />
              </ActionButton>
            </ActionGroup>
          ) : undefined
        }
        actions={
          <ActionButton
            label={t("library.crates.removeAlbum", { name: album.name })}
            tooltip={t("common.remove")}
            onClick={onRemove}
          >
            <Trash2 size={CRATE_ICON_SIZE.md} />
          </ActionButton>
        }
      />
    </li>
  );
}
