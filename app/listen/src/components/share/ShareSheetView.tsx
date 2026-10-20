import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Camera,
  Copy,
  ImagePlus,
  Loader2,
  MessageCircle,
  Send,
  CRATE_ICON_SIZE,
  type CrateIcon,
} from "@crate/ui/icons";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

export interface ShareStoryChoice {
  id: string;
  title: string;
  subtitle: string;
  icon: CrateIcon;
}
export interface ShareSheetViewProps {
  context: string;
  title: string;
  subtitle?: string | null;
  preview: ReactNode;
  displayUrl: string;
  diggingOnly: boolean;
  choosingStoryStyle: boolean;
  storyChoices: ShareStoryChoice[];
  busyAction: "story" | "square" | null;
  storyDisabled: boolean;
  storySubtitle: string;
  onClose: () => void;
  onBack: () => void;
  onWhatsApp: () => void;
  onTelegram: () => void;
  onCopy: () => void;
  onStory: () => void;
  onSquare: () => void;
  onChooseStyle: (index: number) => void;
}

/** Actual share presentation. Native sharing, canvas, clipboard and storage stay in the host. */
export function ShareSheetView(props: ShareSheetViewProps) {
  const { t } = useTranslation();
  const busy = props.busyAction !== null;
  return (
    <AppModal
      open
      onClose={props.onClose}
      ariaLabel={props.context}
      size="sm"
      mobileSafeArea
      closeOnEscape={!busy}
      closeOnOverlay={!busy}
      panelClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <ModalHeader className="p-5">
        <div className="flex min-w-0 items-start gap-3">
          {props.preview}
          <div className="min-w-0 flex-1">
            <MonoLabel tone="accent">{props.context}</MonoLabel>
            <h2 className="mt-2 wrap-anywhere font-display text-xl font-bold text-text-primary">
              {props.title}
            </h2>
            {props.subtitle ? (
              <p className="mt-1 wrap-anywhere text-sm text-text-muted">
                {props.subtitle}
              </p>
            ) : null}
          </div>
          <ModalCloseButton
            label={t("share.closeMenu")}
            disabled={busy}
            onClick={props.onClose}
          />
        </div>
      </ModalHeader>
      <ModalBody className="min-h-0 overflow-y-auto p-5">
        {props.choosingStoryStyle ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <ActionButton
                label={t("share.storyStyle.back")}
                tooltip={t("common.back")}
                disabled={busy}
                onClick={props.onBack}
              >
                <ArrowLeft />
              </ActionButton>
              <MonoLabel as="h3">{t("share.storyStyle.title")}</MonoLabel>
            </div>
            {props.storyChoices.map((choice, index) => (
              <ShareActionRow
                key={choice.id}
                icon={choice.icon}
                title={choice.title}
                subtitle={choice.subtitle}
                busy={props.busyAction === "story"}
                disabled={props.storyDisabled || busy}
                onClick={() => props.onChooseStyle(index)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            {!props.diggingOnly ? (
              <>
                <ShareActionRow
                  icon={MessageCircle}
                  title="WhatsApp"
                  subtitle={t("share.whatsappSubtitle")}
                  disabled={busy}
                  onClick={props.onWhatsApp}
                />
                <ShareActionRow
                  icon={Send}
                  title="Telegram"
                  subtitle={t("share.telegramSubtitle")}
                  disabled={busy}
                  onClick={props.onTelegram}
                />
              </>
            ) : null}
            <ShareActionRow
              icon={Camera}
              title={t("share.instagramStory")}
              subtitle={props.storySubtitle}
              disabled={props.storyDisabled || busy}
              busy={props.busyAction === "story"}
              onClick={props.onStory}
            />
            {!props.diggingOnly ? (
              <>
                <ShareActionRow
                  icon={ImagePlus}
                  title={t("share.squarePost")}
                  subtitle={t("share.squarePostSubtitle")}
                  disabled={busy}
                  busy={props.busyAction === "square"}
                  onClick={props.onSquare}
                />
                <ShareActionRow
                  icon={Copy}
                  title={t("share.copyLink")}
                  subtitle={props.displayUrl}
                  disabled={busy}
                  onClick={props.onCopy}
                />
              </>
            ) : null}
          </div>
        )}
      </ModalBody>
    </AppModal>
  );
}

function ShareActionRow({
  icon: Icon,
  title,
  subtitle,
  busy = false,
  disabled,
  onClick,
}: {
  icon: CrateIcon;
  title: string;
  subtitle: string;
  busy?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <EntityRow
      title={title}
      titleContent={<MonoLabel as="span">{title}</MonoLabel>}
      subtitle={subtitle}
      leading={
        <span
          className="flex size-12 shrink-0 items-center justify-center text-accent-action"
          aria-hidden="true"
        >
          {busy ? (
            <Loader2 size={CRATE_ICON_SIZE.md} className="animate-spin" />
          ) : (
            <Icon size={CRATE_ICON_SIZE.md} />
          )}
        </span>
      }
      onOpen={onClick}
      openLabel={title}
      disabled={disabled}
      aria-busy={busy || undefined}
      truncate={false}
      menuButton="none"
    />
  );
}
