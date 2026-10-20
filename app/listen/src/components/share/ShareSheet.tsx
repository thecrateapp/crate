import { useEffect, useMemo, useState } from "react";
import { Copy, LayoutGrid, ListOrdered, Podium, Send } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ShareSheetView } from "./ShareSheetView";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
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

  const styles = orderedCrateStoryStyles();
  return (
    <ShareSheetView
      context={t("share.title", { kind: t(`share.kind.${payload.kind}`) })}
      title={payload.title}
      subtitle={payload.subtitle}
      preview={
        <MediaCover
          src={payload.imageUrl}
          alt=""
          fallbackIcon={Send}
          className="size-16 shrink-0"
          renderImage={(image) => (
            <ArtworkSurface
              source={image.src}
              alt={image.alt}
              className="size-full"
              imageClassName={image.className}
              fallback={image.fallback}
            />
          )}
        />
      }
      displayUrl={formatShareDisplayUrl(payload.url)}
      diggingOnly={payload.kind === "digging"}
      choosingStoryStyle={choosingStoryStyle}
      storyChoices={styles.map((style) => ({
        id: style,
        title: t(`share.storyStyle.${style}.title`),
        subtitle: t(`share.storyStyle.${style}.subtitle`),
        icon: CRATE_STORY_STYLE_ICONS[style],
      }))}
      busyAction={busyAction}
      storyDisabled={storyDisabled}
      storySubtitle={storySubtitle}
      onClose={close}
      onBack={() => setChoosingStoryStyle(false)}
      onWhatsApp={() =>
        void openTarget(buildWhatsAppShareUrl(payload, shareText))
      }
      onTelegram={() =>
        void openTarget(buildTelegramShareUrl(payload, shareText))
      }
      onCopy={() => void copyLink()}
      onStory={() =>
        payload.kind === "crate"
          ? setChoosingStoryStyle(true)
          : void shareImage("story")
      }
      onSquare={() => void shareImage("square")}
      onChooseStyle={(index) => void shareImage("story", styles[index])}
    />
  );
}
