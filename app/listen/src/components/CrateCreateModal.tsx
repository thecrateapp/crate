import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { toast } from "sonner";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";

import {
  CrateForm,
  EMPTY_CRATE_FORM_VALUES,
  crateFormPayload,
  isCrateFormValid,
  type CrateFormValues,
} from "@/components/crates/CrateForm";
import { api } from "@/lib/api";

export interface CrateComposerAlbum {
  globalAlbumUid: string;
  name: string;
  artistName: string;
}

export interface CreatedCrate {
  id: string;
  public_ref?: string | null;
}

interface CrateCreateModalProps {
  open: boolean;
  initialAlbum?: CrateComposerAlbum;
  onClose: () => void;
  onCreated: (crate: CreatedCrate) => void;
}

const FORM_ID = "crate-create-form";

export function CrateCreateModal({
  open,
  initialAlbum,
  onClose,
  onCreated,
}: CrateCreateModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<CrateFormValues>(
    EMPTY_CRATE_FORM_VALUES,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCrateFormValid(values) || submitting) return;

    setSubmitting(true);
    try {
      const created = await api<CreatedCrate>(
        "/api/crates",
        "POST",
        crateFormPayload(values, true),
      );
      let albumAddFailed = false;
      if (initialAlbum) {
        try {
          await api(`/api/crates/${created.id}/albums`, "POST", {
            global_album_uid: initialAlbum.globalAlbumUid,
          });
        } catch {
          albumAddFailed = true;
        }
      }
      toast.success(t("library.crates.created"));
      if (albumAddFailed) toast.error(t("album.toasts.addToCrateFailed"));
      onCreated(created);
    } catch {
      toast.error(t("library.crates.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (!submitting) onClose();
  }

  return (
    <AppModal
      open={open}
      onClose={close}
      maxWidthClassName="sm:max-w-2xl"
      panelClassName="listen-glass-panel border-border-quiet"
      closeOnEscape={!submitting}
      closeOnOverlay={!submitting}
    >
      <div className="flex max-h-[92vh] flex-col">
        <ModalHeader className="flex items-center justify-between gap-4 bg-transparent px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.crates.createTitle")}
            </h2>
            {initialAlbum ? (
              <p className="mt-1 truncate text-xs text-text-muted">
                {initialAlbum.name} · {initialAlbum.artistName}
              </p>
            ) : null}
          </div>
          <ModalCloseButton onClick={close} disabled={submitting} />
        </ModalHeader>
        <ModalBody className="p-5">
          <CrateForm
            id={FORM_ID}
            values={values}
            isOwner
            disabled={submitting}
            onChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
            onSubmit={(event) => void handleSubmit(event)}
          />
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 bg-transparent px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={submitting || !isCrateFormValid(values)}
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {t("library.crates.create")}
          </Button>
        </ModalFooter>
      </div>
    </AppModal>
  );
}
