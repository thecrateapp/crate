import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Disc3,
  Loader2,
  Trash2,
  Users,
  X,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateAlbumPicker } from "@/components/CrateAlbumPicker";
import type {
  CatalogAlbum,
  CrateAlbum,
  CrateDetail,
  CrateMember,
} from "@/pages/crates-types";

interface CrateEditorProps {
  crateId: string | null;
  onBack: () => void;
  onCreated: (crateId: string) => void;
  onDeleted: () => void;
}

interface CreateResponse {
  id: string;
}

interface InviteResponse {
  join_url: string;
}

export function CrateEditor({
  crateId,
  onBack,
  onCreated,
  onDeleted,
}: CrateEditorProps) {
  const { t } = useTranslation();
  const {
    data: crate,
    loading,
    error,
  } = useApi<CrateDetail>(crateId ? `/api/crates/${crateId}` : null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  if (crateId === null) {
    async function createCrate(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) return;

      setCreating(true);
      try {
        const result = await api<CreateResponse>("/api/crates", "POST", {
          name: trimmedName,
          description: description.trim(),
          is_collaborative: false,
        });
        toast.success(t("library.crates.created"));
        onCreated(result.id);
      } catch {
        toast.error(t("library.crates.createFailed"));
      } finally {
        setCreating(false);
      }
    }

    return (
      <section className="mx-auto w-full max-w-2xl space-y-5">
        <EditorHeader title={t("library.crates.createTitle")} onBack={onBack} />
        <form onSubmit={createCrate} className="space-y-4">
          <TextField
            label={t("common.name")}
            value={name}
            onChange={setName}
            maxLength={120}
            required
          />
          <TextField
            label={t("library.crates.description")}
            value={description}
            onChange={setDescription}
            multiline
            maxLength={2000}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <SecondaryButton onClick={onBack}>
              {t("common.cancel")}
            </SecondaryButton>
            <PrimaryButton disabled={creating || !name.trim()} type="submit">
              {creating ? <Loader2 size={16} className="animate-spin" /> : null}
              {t("library.crates.create")}
            </PrimaryButton>
          </div>
        </form>
      </section>
    );
  }

  if (loading || !crate) {
    return (
      <div className="space-y-4">
        <EditorHeader title={t("library.crates.title")} onBack={onBack} />
        {error ? (
          <p
            role="alert"
            className="py-12 text-center text-sm text-destructive"
          >
            {t("library.crates.loadFailed")}
          </p>
        ) : (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        )}
      </div>
    );
  }

  return (
    <CrateEditorForm
      key={`${crate.id}:${crate.updated_at ?? ""}`}
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
  const [name, setName] = useState(crate.name);
  const [description, setDescription] = useState(crate.description ?? "");
  const [visibility, setVisibility] = useState(crate.visibility);
  const [collaborative, setCollaborative] = useState(crate.is_collaborative);
  const [collaborationSaved, setCollaborationSaved] = useState(
    crate.is_collaborative,
  );
  const [albums, setAlbums] = useState(crate.albums);
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const membersUrl =
    isOwner && collaborative ? `/api/crates/${crate.id}/members` : null;
  const { data: members, refetch: refetchMembers } =
    useApi<CrateMember[]>(membersUrl);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      await api(`/api/crates/${crate.id}`, "PUT", {
        name: trimmedName,
        description: description.trim(),
        ...(isOwner ? { visibility, is_collaborative: collaborative } : {}),
      });
      if (isOwner) setCollaborationSaved(collaborative);
      toast.success(t("library.crates.saved"));
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
    } catch {
      toast.error(t("library.crates.albumAddFailed"));
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

  async function moveAlbum(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= albums.length) return;
    const reordered = [...albums];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex]!,
      reordered[index]!,
    ];
    try {
      await api(`/api/crates/${crate.id}/albums/order`, "PUT", {
        global_album_uids: reordered.map((album) => album.global_album_uid),
      });
      setAlbums(reordered.map((album, position) => ({ ...album, position })));
    } catch {
      toast.error(t("library.crates.reorderFailed"));
    }
  }

  async function createInvite() {
    setInviteBusy(true);
    try {
      const invite = await api<InviteResponse>(
        `/api/crates/${crate.id}/invites`,
        "POST",
        {},
      );
      setInviteLink(
        new URL(invite.join_url, window.location.origin).toString(),
      );
    } catch {
      toast.error(t("library.crates.inviteFailed"));
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteLink || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t("share.toasts.linkCopied"));
    } catch {
      toast.error(t("share.toasts.copyFailed"));
    }
  }

  async function removeMember(userId: number) {
    try {
      await api(`/api/crates/${crate.id}/members/${userId}`, "DELETE");
      refetchMembers();
    } catch {
      toast.error(t("library.crates.memberRemoveFailed"));
    }
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
    <section className="mx-auto w-full max-w-3xl space-y-5">
      <EditorHeader title={crate.name} onBack={onBack} />

      <form onSubmit={save} className="space-y-4">
        <TextField
          label={t("common.name")}
          value={name}
          onChange={setName}
          maxLength={120}
          required
        />
        <TextField
          label={t("library.crates.description")}
          value={description}
          onChange={setDescription}
          multiline
          maxLength={2000}
        />

        {isOwner && (
          <div className="grid gap-4 rounded-xl border border-white/8 bg-white/[0.025] p-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              {t("library.crates.visibility")}
              <select
                aria-label={t("library.crates.visibility")}
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as "public" | "private")
                }
                className="h-11 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-foreground outline-none focus:border-primary/60"
              >
                <option value="private">{t("library.crates.private")}</option>
                <option value="public">{t("library.crates.public")}</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-3 self-end rounded-lg bg-white/[0.035] px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={collaborative}
                onChange={(event) => {
                  setCollaborative(event.target.checked);
                  setCollaborationSaved(false);
                  setInviteLink(null);
                }}
                className="size-4 accent-primary"
              />
              <Users size={16} className="text-primary" />
              {t("library.crates.allowCollaboration")}
            </label>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onBack}>
            {t("common.cancel")}
          </SecondaryButton>
          <PrimaryButton disabled={saving || !name.trim()} type="submit">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("common.save")}
          </PrimaryButton>
        </div>
      </form>

      {isOwner && collaborative && (
        <section className="space-y-3 rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <div>
            <h2 className="font-semibold text-foreground">
              {t("library.crates.collaborators")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("library.crates.inviteDescription")}
            </p>
            {!collaborationSaved && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("library.crates.saveBeforeInvite")}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={inviteBusy || !collaborationSaved}
            onClick={() => void createInvite()}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-white/8 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/12 disabled:opacity-50"
          >
            {inviteBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Users size={16} />
            )}
            {t("library.crates.createInvite")}
          </button>
          {inviteLink && (
            <div className="flex gap-2">
              <input
                aria-label={t("library.crates.inviteLink")}
                readOnly
                value={inviteLink}
                className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-muted-foreground"
              />
              <button
                type="button"
                aria-label={t("share.copyLink")}
                onClick={() => void copyInvite()}
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/8 text-foreground hover:bg-white/12"
              >
                <Copy size={16} />
              </button>
            </div>
          )}
          {members?.map((member) => (
            <div
              key={member.user_id}
              className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.035] px-3 py-2"
            >
              <span className="truncate text-sm text-foreground">
                {member.display_name || member.username || `#${member.user_id}`}
              </span>
              <button
                type="button"
                aria-label={t("library.crates.removeMember", {
                  name:
                    member.display_name || member.username || member.user_id,
                })}
                onClick={() => void removeMember(member.user_id)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-destructive"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {t("library.crates.albums")}
          </h2>
          <span className="text-sm text-muted-foreground">
            {t("common.albumCountLabel", { count: albums.length })}
          </span>
        </div>
        {albums.length > 0 ? (
          <ol className="divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
            {albums.map((album, index) => (
              <CrateAlbumRow
                key={album.global_album_uid}
                album={album}
                index={index}
                total={albums.length}
                onMove={moveAlbum}
                onRemove={() => void removeAlbum(album)}
              />
            ))}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("library.crates.noAlbums")}
          </div>
        )}
        <CrateAlbumPicker
          existingAlbumUids={existingAlbumUids}
          onAdd={addAlbum}
        />
      </section>

      {isOwner && (
        <section className="border-t border-white/8 pt-5">
          {deleteConfirmation ? (
            <div className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm text-foreground">
                {t("library.crates.deleteConfirmation", { name: crate.name })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void deleteCrate()}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90"
                >
                  {t("library.crates.confirmDelete")}
                </button>
                <SecondaryButton onClick={() => setDeleteConfirmation(false)}>
                  {t("common.cancel")}
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirmation(true)}
              className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-destructive transition-colors hover:bg-destructive/8"
            >
              <Trash2 size={15} />
              {t("library.crates.delete")}
            </button>
          )}
        </section>
      )}
    </section>
  );
}

function CrateAlbumRow({
  album,
  index,
  total,
  onMove,
  onRemove,
}: {
  album: CrateAlbum;
  index: number;
  total: number;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
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

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-white/5">
        {album.has_cover ? (
          <CrateImage
            src={cover}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-white/30">
            <Disc3 size={20} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {album.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {album.artist_name}
          {album.year ? ` · ${album.year}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label={t("library.crates.moveAlbumUp", { name: album.name })}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-25"
        >
          <ChevronUp size={17} />
        </button>
        <button
          type="button"
          aria-label={t("library.crates.moveAlbumDown", { name: album.name })}
          disabled={index === total - 1}
          onClick={() => onMove(index, 1)}
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-foreground disabled:opacity-25"
        >
          <ChevronDown size={17} />
        </button>
        <button
          type="button"
          aria-label={t("library.crates.removeAlbum", { name: album.name })}
          onClick={onRemove}
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-destructive"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

function EditorHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-11 items-center gap-3">
      <button
        type="button"
        aria-label={t("common.back")}
        onClick={onBack}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/8 hover:text-foreground"
      >
        <ArrowLeft size={18} />
      </button>
      <h1 className="min-w-0 truncate text-xl font-bold text-foreground">
        {title}
      </h1>
    </header>
  );
}

function TextField({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
  required?: boolean;
}) {
  const className =
    "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60";
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          rows={3}
          className={`${className} resize-y`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          required={required}
          className={`${className} h-11`}
        />
      )}
    </label>
  );
}

function PrimaryButton({
  children,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center justify-center rounded-lg bg-white/6 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  );
}
