import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { CollectionEditorDialog } from "./collections/CollectionEditorDialog";

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
      notify.success(t("library.crates.created"));
      if (albumAddFailed) notify.error(t("album.toasts.addToCrateFailed"));
      onCreated(created);
    } catch {
      notify.error(t("library.crates.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (!submitting) onClose();
  }

  return (
    <CollectionEditorDialog
      open={open}
      title={t("library.crates.createTitle")}
      description={
        initialAlbum ? (
          <span>
            {initialAlbum.name} · {initialAlbum.artistName}
          </span>
        ) : undefined
      }
      formId={FORM_ID}
      submitLabel={t("library.crates.create")}
      cancelLabel={t("common.cancel")}
      closeLabel={t("common.close")}
      pending={submitting}
      submitDisabled={!isCrateFormValid(values)}
      onCancel={close}
    >
      <CrateForm
        id={FORM_ID}
        values={values}
        isOwner
        disabled={submitting}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        onSubmit={(event) => void handleSubmit(event)}
      />
    </CollectionEditorDialog>
  );
}
