import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@crate/ui/icons";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

export interface CrateComposerAlbum {
  globalAlbumUid: string;
  name: string;
  artistName: string;
}

interface CrateCreateModalProps {
  open: boolean;
  initialAlbum?: CrateComposerAlbum;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; description: string }) => Promise<void>;
}

export function CrateCreateModal({
  open,
  initialAlbum,
  submitting,
  onClose,
  onSubmit,
}: CrateCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
  }, [open, initialAlbum]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    await onSubmit({ name: trimmedName, description: description.trim() });
  }

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      maxWidthClassName="sm:max-w-lg"
      panelClassName="listen-glass-panel border-border-quiet"
      closeOnEscape={!submitting}
      closeOnOverlay={!submitting}
    >
      <form onSubmit={handleSubmit}>
        <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.crates.createTitle")}
            </h2>
            {initialAlbum ? (
              <p className="mt-1 text-xs text-text-muted">
                {initialAlbum.name} · {initialAlbum.artistName}
              </p>
            ) : null}
          </div>
          <ModalCloseButton onClick={onClose} disabled={submitting} />
        </ModalHeader>

        <ModalBody className="space-y-4 px-5 py-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
            {t("common.name")}
            <input
              aria-label={t("common.name")}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              className="h-11 rounded-lg border border-border-quiet bg-text-primary/[0.04] px-3 text-sm text-text-primary outline-none focus:border-accent-action/60"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
            {t("library.crates.description")}
            <textarea
              aria-label={t("library.crates.description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="rounded-lg border border-border-quiet bg-text-primary/[0.04] px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-action/60"
            />
          </label>
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("library.crates.create")}
          </button>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
