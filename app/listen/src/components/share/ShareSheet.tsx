import { useEffect, useMemo, useState } from "react";
import {
  CRATE_ICON_SIZE,
  Camera,
  Copy,
  ImagePlus,
  Loader2,
  MessageCircle,
  Send,
  X,
} from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { AppModal } from "@crate/ui/primitives/AppModal";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  buildInstagramStoryBlob,
  buildShareImageFileName,
  buildSquarePostCard,
  buildTelegramShareUrl,
  buildWhatsAppShareUrl,
  canShareInstagramStory,
  shareImageFile,
  shareInstagramStory,
  subscribeShareRequests,
  type ShareImageFormat,
  type SharePayload,
} from "@/lib/social-share";
import {
  buildLocalizedShareText,
  buildShareCardLabels,
} from "@/lib/social-share-labels";
import { formatShareDisplayUrl } from "@/lib/social-share-story-canvas";
import { isNative } from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";
import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";

type ShareImageAction = ShareImageFormat;

export function ShareSheetHost() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [instagramAvailable, setInstagramAvailable] = useState(false);
  const [busyAction, setBusyAction] = useState<ShareImageAction | null>(null);

  useEffect(() => subscribeShareRequests(setPayload), []);

  useEffect(() => {
    let cancelled = false;
    if (!payload || !isNative) {
      setInstagramAvailable(false);
      return;
    }
    canShareInstagramStory()
      .then((available) => {
        if (!cancelled) setInstagramAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setInstagramAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const shareText = useMemo(
    () => (payload ? buildLocalizedShareText(t, payload) : ""),
    [payload, t],
  );

  if (!payload) return null;

  const close = () => {
    if (busyAction) return;
    setPayload(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payload.url);
      notify.success(t("share.toasts.linkCopied"));
      setPayload(null);
    } catch {
      notify.error(t("share.toasts.copyFailed"));
    }
  };

  const openTarget = async (url: string) => {
    try {
      await openExternalUrl(url);
      setPayload(null);
    } catch {
      notify.error(t("share.toasts.targetFailed"));
    }
  };

  const shareImage = async (action: ShareImageAction) => {
    if (busyAction) return;
    setBusyAction(action);
    const labels = buildShareCardLabels(t, payload);
    try {
      if (action === "story" && isNative) {
        await shareInstagramStory(payload, labels);
        setPayload(null);
        return;
      }
      const blob =
        action === "story"
          ? await buildInstagramStoryBlob(payload, labels)
          : await buildSquarePostCard(payload, labels);
      const result = await shareImageFile(
        blob,
        buildShareImageFileName(payload, action),
        { title: payload.title, allowDownload: !isNative },
      );
      if (result === "cancelled") return;
      if (result === "downloaded") {
        notify.success(t("share.toasts.imageDownloaded"));
      }
      setPayload(null);
    } catch (error) {
      recordDevLog(
        "share",
        "Share image action failed",
        {
          action,
          kind: payload.kind,
          error: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
      notify.error(
        action === "story"
          ? t("share.toasts.instagramFailed")
          : t("share.toasts.imageFailed"),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const storyDisabled =
    busyAction !== null || (isNative && !instagramAvailable);
  const storySubtitle = isNative
    ? instagramAvailable
      ? t("share.instagramAvailable")
      : t("share.instagramUnavailable")
    : t("share.instagramStoryWeb");

  return (
    <AppModal
      open
      onClose={close}
      ariaLabel={t("share.title", { kind: t(`share.kind.${payload.kind}`) })}
      maxWidthClassName="sm:max-w-[420px]"
      panelClassName="listen-glass-panel overflow-hidden rounded-panel"
      overlayClassName="bg-surface-canvas/58"
      mobileSafeArea
    >
      <div className="relative overflow-hidden">
        <div className="relative flex items-start gap-3 border-b border-text-primary/8 bg-surface-canvas/[0.08] p-4 ">
          <SharePreviewImage payload={payload} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-xs font-bold uppercase tracking-eyebrow text-accent-action">
              {t("share.title", {
                kind: t(`share.kind.${payload.kind}`),
              })}
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-text-primary">
              {payload.title}
            </h2>
            {payload.subtitle ? (
              <p className="truncate text-sm text-text-muted">
                {payload.subtitle}
              </p>
            ) : null}
          </div>
          <IconButton
            label={t("share.closeMenu")}
            variant="card"
            size="sm"
            onClick={close}
          >
            <X size={CRATE_ICON_SIZE.md} />
          </IconButton>
        </div>

        <div className="relative space-y-2 p-4 ">
          <ShareAction
            icon={MessageCircle}
            title="WhatsApp"
            subtitle={t("share.whatsappSubtitle")}
            onClick={() =>
              void openTarget(buildWhatsAppShareUrl(payload, shareText))
            }
          />
          <ShareAction
            icon={Send}
            title="Telegram"
            subtitle={t("share.telegramSubtitle")}
            onClick={() =>
              void openTarget(buildTelegramShareUrl(payload, shareText))
            }
          />
          <ShareAction
            icon={busyAction === "story" ? Loader2 : Camera}
            title={t("share.instagramStory")}
            subtitle={storySubtitle}
            disabled={storyDisabled}
            busy={busyAction === "story"}
            onClick={() => void shareImage("story")}
          />
          <ShareAction
            icon={busyAction === "square" ? Loader2 : ImagePlus}
            title={t("share.squarePost")}
            subtitle={t("share.squarePostSubtitle")}
            disabled={busyAction !== null}
            busy={busyAction === "square"}
            onClick={() => void shareImage("square")}
          />
          <ShareAction
            icon={Copy}
            title={t("share.copyLink")}
            subtitle={formatShareDisplayUrl(payload.url)}
            onClick={() => void copyLink()}
          />
        </div>
      </div>
    </AppModal>
  );
}

function SharePreviewImage({ payload }: { payload: SharePayload }) {
  if (payload.imageUrl) {
    return (
      <CrateImage
        src={payload.imageUrl}
        alt=""
        className=" size-16 shrink-0 rounded-xl border border-border-quiet object-cover shadow-share-preview"
      />
    );
  }
  return (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-accent-action/20 bg-accent-action/10 text-accent-action shadow-share-preview">
      <span className="text-lg font-black">C</span>
    </div>
  );
}

function ShareAction({
  icon: Icon,
  title,
  subtitle,
  disabled = false,
  busy = false,
  onClick,
}: {
  icon: typeof Copy;
  title: string;
  subtitle: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border border-border-quiet bg-surface-canvas/20 px-3 py-3 text-left transition",
        "hover:border-text-primary/20 hover:bg-text-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        disabled &&
          "cursor-not-allowed opacity-45 hover:border-border-quiet hover:bg-surface-canvas/20",
        busy && "opacity-100",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-quiet bg-text-primary/[0.06] text-accent-action shadow-share-action-icon backdrop-blur">
        <Icon
          size={CRATE_ICON_SIZE.md}
          className={busy ? "animate-spin" : ""}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-text-primary">
          {title}
        </span>
        <span className="block truncate text-xs text-text-muted">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
