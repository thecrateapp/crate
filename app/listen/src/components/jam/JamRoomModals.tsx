import type { ReactNode } from "react";
import { Copy, ListMusic, Loader2, QrCode } from "@crate/ui/icons";
import type { TFunction } from "i18next";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";

export interface JamRoomModalsProps {
  t: TFunction;
  deleteRoomModal: ReactNode;
  metadataModalOpen: boolean;
  setMetadataModalOpen: (value: boolean) => void;
  metadataDescription: string;
  setMetadataDescription: (value: string) => void;
  metadataTagsInput: string;
  setMetadataTagsInput: (value: string) => void;
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  saveRoomMetadata: () => void | Promise<void>;
  inviteLink: string | null;
  inviteModalOpen: boolean;
  setInviteModalOpen: (value: boolean) => void;
  copyInviteLink: (link: string) => void | Promise<void>;
}

export function JamRoomModals({
  t,
  deleteRoomModal,
  metadataModalOpen,
  setMetadataModalOpen,
  metadataDescription,
  setMetadataDescription,
  metadataTagsInput,
  setMetadataTagsInput,
  updatingRoomField,
  saveRoomMetadata,
  inviteLink,
  inviteModalOpen,
  setInviteModalOpen,
  copyInviteLink,
}: JamRoomModalsProps) {
  return (
    <>
      {deleteRoomModal}

      <AppModal
        open={metadataModalOpen}
        onClose={() => setMetadataModalOpen(false)}
        maxWidthClassName="sm:max-w-lg"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("jam.room.profileModalTitle")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("jam.room.profileModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setMetadataModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-text-muted">
                {t("jam.room.descriptionLabel")}
              </span>
              <textarea
                value={metadataDescription}
                onChange={(event) => setMetadataDescription(event.target.value)}
                rows={4}
                placeholder={t("jam.room.descriptionPlaceholder")}
                className="jam-input mt-2 w-full resize-none rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-text-muted">
                {t("jam.room.tagsLabel")}
              </span>
              <input
                value={metadataTagsInput}
                onChange={(event) => setMetadataTagsInput(event.target.value)}
                placeholder={t("jam.room.tagsPlaceholder")}
                className="jam-input mt-2 h-11 w-full rounded-lg px-4 text-sm text-text-primary placeholder:text-text-muted"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetadataModalOpen(false)}
                className="jam-secondary-action rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveRoomMetadata()}
                disabled={updatingRoomField === "metadata"}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground hover:bg-accent-action/90 transition-colors disabled:opacity-60"
              >
                {updatingRoomField === "metadata" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ListMusic size={15} />
                )}
                {t("jam.room.saveProfile")}
              </button>
            </div>
          </div>
        </ModalBody>
      </AppModal>

      <AppModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        maxWidthClassName="sm:max-w-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("jam.room.inviteModalTitle")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("jam.room.inviteModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setInviteModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          {inviteLink ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QrCodeImage
                  value={inviteLink}
                  size={210}
                  className="jam-qr-surface rounded-xl p-3"
                />
              </div>
              <div className="jam-input rounded-lg px-4 py-3 text-xs text-text-muted break-all">
                {inviteLink}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteLink)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground hover:bg-accent-action/90 transition-colors"
                >
                  <Copy size={15} />
                  {t("jam.room.copyLink")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyInviteLink(inviteLink);
                    setInviteModalOpen(false);
                  }}
                  className="jam-secondary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
                >
                  <QrCode size={15} />
                  {t("jam.room.done")}
                </button>
              </div>
            </div>
          ) : null}
        </ModalBody>
      </AppModal>
    </>
  );
}
