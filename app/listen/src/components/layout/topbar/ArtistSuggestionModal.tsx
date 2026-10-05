import { useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, Send } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
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

import type { useArtistSuggestionController } from "./use-artist-suggestion-controller";

const FIELD_LABEL_CLASS_NAME =
  "text-xs font-semibold uppercase tracking-label text-text-primary/45";
const FIELD_CONTROL_CLASS_NAME =
  "bg-text-primary/[0.04] px-3 shadow-none backdrop-blur-none placeholder:text-text-primary/25 md:text-base";

type ArtistSuggestionController = ReturnType<
  typeof useArtistSuggestionController
>;

export function ArtistSuggestionModal({
  controller,
}: {
  controller: ArtistSuggestionController;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  if (!controller.open || typeof document === "undefined") return null;

  return createPortal(
    <AppModal
      open={controller.open}
      onClose={controller.closeModal}
      size="sm"
      ariaLabelledBy={titleId}
      backdropLabel={t("common.close")}
    >
      <form onSubmit={controller.submit}>
        <ModalHeader className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-eyebrow text-accent-action">
                {t("userMenu.suggest.badge")}
              </p>
              <h2
                id={titleId}
                className="mt-1 text-lg font-semibold text-text-primary"
              >
                {t("userMenu.suggest.title")}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {t("userMenu.suggest.description")}
              </p>
            </div>
            <ModalCloseButton
              onClick={controller.closeModal}
              disabled={controller.sending}
              label={t("common.close")}
            />
          </div>
        </ModalHeader>
        <ModalBody className="space-y-4 p-5 ">
          <FormField
            label={t("userMenu.suggest.artistLabel")}
            error={controller.error}
            className="gap-2"
            labelClassName={FIELD_LABEL_CLASS_NAME}
          >
            <Input
              value={controller.artist}
              onChange={(event) => controller.setArtist(event.target.value)}
              placeholder="High Vis, Denzel Curry, ..."
              className={FIELD_CONTROL_CLASS_NAME}
              required
              minLength={2}
              maxLength={200}
            />
          </FormField>
          <FormField
            label={t("userMenu.suggest.linkLabel")}
            className="gap-2"
            labelClassName={FIELD_LABEL_CLASS_NAME}
          >
            <Input
              value={controller.url}
              onChange={(event) => controller.setUrl(event.target.value)}
              placeholder="Bandcamp, Tidal, Spotify, YouTube…"
              className={FIELD_CONTROL_CLASS_NAME}
              maxLength={500}
            />
          </FormField>
          <FormField
            label={t("userMenu.suggest.noteLabel")}
            className="gap-2"
            labelClassName={FIELD_LABEL_CLASS_NAME}
          >
            <Textarea
              value={controller.note}
              onChange={(event) => controller.setNote(event.target.value)}
              placeholder={t("userMenu.suggest.notePlaceholder")}
              className={`min-h-24 resize-none py-2 ${FIELD_CONTROL_CLASS_NAME}`}
              maxLength={1000}
            />
          </FormField>
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2 px-5 py-4">
          <Button
            variant="outline"
            onClick={controller.closeModal}
            disabled={controller.sending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            loading={controller.sending}
            disabled={controller.artistName.length < 2}
            className="font-semibold"
          >
            {controller.sending ? null : <Send size={CRATE_ICON_SIZE.sm} />}
            {controller.sending
              ? t("userMenu.suggest.sending")
              : t("userMenu.suggest.submit")}
          </Button>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
}
