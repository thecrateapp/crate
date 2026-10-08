import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CRATE_ICON_SIZE,
  Camera,
  Copy,
  ImagePlus,
  LayoutGrid,
  ListOrdered,
  Loader2,
  MessageCircle,
  Podium,
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
import {
  CRATE_STORY_STYLES,
  DEFAULT_CRATE_STORY_STYLE,
  formatShareDisplayUrl,
  type CrateStoryStyle,
} from "@/lib/social-share-story-canvas";
import { isNative } from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";
import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";

type ShareImageAction = ShareImageFormat;

const CRATE_STORY_STYLE_STORAGE_KEY = "crate:share:crate-story-style";
const CRATE_STORY_STYLE_ICONS: Record<CrateStoryStyle, typeof Copy> = {
  bento: LayoutGrid,
  podium: Podium,
  chart: ListOrdered,
};

function readLastCrateStoryStyle(): CrateStoryStyle {
  try {
    const stored = window.localStorage.getItem(CRATE_STORY_STYLE_STORAGE_KEY);
    return (
      CRATE_STORY_STYLES.find((style) => style === stored) ??
      DEFAULT_CRATE_STORY_STYLE
    );
  } catch {
    return DEFAULT_CRATE_STORY_STYLE;
  }
}

function rememberCrateStoryStyle(style: CrateStoryStyle) {
  try {
    window.localStorage.setItem(CRATE_STORY_STYLE_STORAGE_KEY, style);
  } catch {
    return;
  }
}

function orderedCrateStoryStyles(): CrateStoryStyle[] {
  const last = readLastCrateStoryStyle();
  return [last, ...CRATE_STORY_STYLES.filter((style) => style !== last)];
}

export function ShareSheetHost() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [instagramAvailable, setInstagramAvailable] = useState(false);
  const [busyAction, setBusyAction] = useState<ShareImageAction | null>(null);
  const [choosingStoryStyle, setChoosingStoryStyle] = useState(false);

  useEffect(
    () =>
      subscribeShareRequests((next) => {
        setChoosingStoryStyle(false);
        setPayload(next);
      }),
    [],
  );

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

  const shareImage = async (
    action: ShareImageAction,
    crateStoryStyle?: CrateStoryStyle,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    if (crateStoryStyle) rememberCrateStoryStyle(crateStoryStyle);
    const imagePayload = crateStoryStyle
      ? { ...payload, crateStoryStyle }
      : payload;
    const labels = buildShareCardLabels(t, imagePayload);
    try {
      if (action === "story" && isNative) {
        await shareInstagramStory(imagePayload, labels);
        setPayload(null);
        return;
      }
      const blob =
        action === "story"
          ? await buildInstagramStoryBlob(imagePayload, labels)
          : await buildSquarePostCard(imagePayload, labels);
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

        {choosingStoryStyle ? (
          <div className="relative space-y-2 p-4 ">
            <div className="flex items-center gap-2 pb-1">
              <IconButton
                label={t("share.storyStyle.back")}
                variant="card"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => setChoosingStoryStyle(false)}
              >
                <ArrowLeft size={CRATE_ICON_SIZE.md} />
              </IconButton>
              <p className="text-sm font-bold text-text-primary">
                {t("share.storyStyle.title")}
              </p>
            </div>
            {orderedCrateStoryStyles().map((style) => (
              <ShareAction
                key={style}
                icon={
                  busyAction === "story"
                    ? Loader2
                    : CRATE_STORY_STYLE_ICONS[style]
                }
                title={t(`share.storyStyle.${style}.title`)}
                subtitle={t(`share.storyStyle.${style}.subtitle`)}
                disabled={storyDisabled}
                busy={busyAction === "story"}
                onClick={() => void shareImage("story", style)}
              />
            ))}
          </div>
        ) : (
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
              onClick={() =>
                payload.kind === "crate"
                  ? setChoosingStoryStyle(true)
                  : void shareImage("story")
              }
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
        )}
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
