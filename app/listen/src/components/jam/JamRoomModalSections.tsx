import {
  Copy,
  CRATE_ICON_SIZE,
  ListMusic,
  Loader2,
  QrCode,
} from "@crate/ui/icons";

import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { FormField } from "@crate/ui/primitives/FormField";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import type { JamRoomModalsProps } from "./JamRoomModals";

const FIELD_LABEL_CLASS_NAME = "text-xs text-text-muted";
const PRIMARY_ACTION_CLASS_NAME =
  "h-auto rounded-lg px-4 py-2.5 shadow-none has-[>svg]:px-4 hover:bg-accent-action/90 [&_svg:not([class*='size-'])]:size-4";
const SECONDARY_ACTION_CLASS_NAME =
  "jam-secondary-action h-auto rounded-lg px-4 py-2.5 has-[>svg]:px-4 text-text-primary hover:text-text-primary [&_svg:not([class*='size-'])]:size-4";

type JamRoomMetadataModalProps = Pick<
  JamRoomModalsProps,
  | "t"
  | "metadataModalOpen"
  | "setMetadataModalOpen"
  | "metadataDescription"
  | "setMetadataDescription"
  | "metadataTagsInput"
  | "setMetadataTagsInput"
  | "updatingRoomField"
  | "saveRoomMetadata"
>;

type JamRoomInviteModalProps = Pick<
  JamRoomModalsProps,
  | "t"
  | "inviteLink"
  | "inviteModalOpen"
  | "setInviteModalOpen"
  | "copyInviteLink"
>;

export function JamRoomMetadataModal({
  t,
  metadataModalOpen,
  setMetadataModalOpen,
  metadataDescription,
  setMetadataDescription,
  metadataTagsInput,
  setMetadataTagsInput,
  updatingRoomField,
  saveRoomMetadata,
}: JamRoomMetadataModalProps) {
  return (
    <AppModal
      open={metadataModalOpen}
      onClose={() => setMetadataModalOpen(false)}
      size="md"
      title={t("jam.room.profileModalTitle")}
      description={t("jam.room.profileModalDescription")}
      closeLabel={t("common.close")}
      backdropLabel={t("common.close")}
    >
      <ModalBody className="p-5 ">
        <div className="space-y-4">
          <FormField
            label={t("jam.room.descriptionLabel")}
            className="gap-2"
            labelClassName={FIELD_LABEL_CLASS_NAME}
          >
            <Textarea
              value={metadataDescription}
              onChange={(event) => setMetadataDescription(event.target.value)}
              rows={4}
              placeholder={t("jam.room.descriptionPlaceholder")}
              className="jam-input min-h-0 resize-none rounded-lg px-4 py-3 shadow-none backdrop-blur-none placeholder:text-text-muted md:text-base"
            />
          </FormField>
          <FormField
            label={t("jam.room.tagsLabel")}
            className="gap-2"
            labelClassName={FIELD_LABEL_CLASS_NAME}
          >
            <Input
              value={metadataTagsInput}
              onChange={(event) => setMetadataTagsInput(event.target.value)}
              placeholder={t("jam.room.tagsPlaceholder")}
              className="jam-input rounded-lg px-4 shadow-none backdrop-blur-none placeholder:text-text-muted md:text-base"
            />
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setMetadataModalOpen(false)}
              className={SECONDARY_ACTION_CLASS_NAME}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void saveRoomMetadata()}
              disabled={updatingRoomField === "metadata"}
              className={PRIMARY_ACTION_CLASS_NAME}
            >
              {updatingRoomField === "metadata" ? (
                <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
              ) : (
                <ListMusic size={CRATE_ICON_SIZE.sm} />
              )}
              {t("jam.room.saveProfile")}
            </Button>
          </div>
        </div>
      </ModalBody>
    </AppModal>
  );
}

export function JamRoomInviteModal({
  t,
  inviteLink,
  inviteModalOpen,
  setInviteModalOpen,
  copyInviteLink,
}: JamRoomInviteModalProps) {
  return (
    <AppModal
      open={inviteModalOpen}
      onClose={() => setInviteModalOpen(false)}
      size="sm"
      title={t("jam.room.inviteModalTitle")}
      description={t("jam.room.inviteModalDescription")}
      closeLabel={t("common.close")}
      backdropLabel={t("common.close")}
    >
      <ModalBody className="p-5 ">
        {inviteLink ? (
          <div className="space-y-4">
            <div className="flex justify-center">
              <QrCodeImage
                value={inviteLink}
                size={210}
                className="jam-qr-surface rounded-xl p-3"
              />
            </div>
            <div className="jam-input break-all rounded-lg px-4 py-3 text-xs text-text-muted">
              {inviteLink}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => copyInviteLink(inviteLink)}
                className={PRIMARY_ACTION_CLASS_NAME}
              >
                <Copy size={CRATE_ICON_SIZE.sm} />
                {t("jam.room.copyLink")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void copyInviteLink(inviteLink);
                  setInviteModalOpen(false);
                }}
                className={SECONDARY_ACTION_CLASS_NAME}
              >
                <QrCode size={CRATE_ICON_SIZE.sm} />
                {t("jam.room.done")}
              </Button>
            </div>
          </div>
        ) : null}
      </ModalBody>
    </AppModal>
  );
}
