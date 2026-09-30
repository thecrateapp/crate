import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
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
            <Input
              aria-label={t("common.name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              className="h-11 rounded-lg bg-surface-canvas/25 px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-text-primary">
            {t("library.crates.description")}
            <Textarea
              aria-label={t("library.crates.description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="min-h-0 rounded-lg bg-surface-canvas/25 px-3 py-2 text-sm"
            />
          </label>
        </ModalBody>

        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            className="text-text-muted"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("library.crates.create")}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>
  );
}
