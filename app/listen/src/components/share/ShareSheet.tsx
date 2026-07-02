import { useEffect, useMemo, useState } from "react";
import { Camera, Copy, Loader2, MessageCircle, Send, X } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AppModal } from "@crate/ui/primitives/AppModal";
import {
  buildShareText,
  buildTelegramShareUrl,
  buildWhatsAppShareUrl,
  canShareInstagramStory,
  shareInstagramStory,
  subscribeShareRequests,
  type SharePayload,
} from "@/lib/social-share";
import { isNative } from "@/lib/capacitor-runtime";
import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";

export function ShareSheetHost() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [instagramAvailable, setInstagramAvailable] = useState(false);
  const [instagramBusy, setInstagramBusy] = useState(false);

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
    () => (payload ? buildShareText(payload) : ""),
    [payload],
  );

  if (!payload) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payload.url);
      toast.success(t("share.toasts.linkCopied"));
      setPayload(null);
    } catch {
      toast.error(t("share.toasts.copyFailed"));
    }
  };

  const openTarget = async (url: string) => {
    try {
      await openExternalUrl(url);
      setPayload(null);
    } catch {
      toast.error(t("share.toasts.targetFailed"));
    }
  };

  const shareToInstagram = async () => {
    setInstagramBusy(true);
    try {
      await shareInstagramStory(payload);
      setPayload(null);
    } catch (error) {
      toast.error(
        (error as Error).message || t("share.toasts.instagramFailed"),
      );
    } finally {
      setInstagramBusy(false);
    }
  };

  return (
    <AppModal
      open
      onClose={() => setPayload(null)}
      maxWidthClassName="sm:max-w-[420px]"
      panelClassName="listen-glass-panel overflow-hidden rounded-[28px]"
      overlayClassName="bg-black/58"
      mobileSafeArea
    >
      <div className="relative overflow-hidden">
        <div className="relative flex items-start gap-3 border-b border-white/8 bg-black/[0.08] px-4 py-4">
          <SharePreviewImage payload={payload} />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {t("share.title", {
                kind: t(`share.kind.${payload.kind}`),
              })}
            </p>
            <h2 className="mt-1 truncate text-lg font-black text-foreground">
              {payload.title}
            </h2>
            {payload.subtitle ? (
              <p className="truncate text-sm text-muted-foreground">
                {payload.subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("share.closeMenu")}
            onClick={() => setPayload(null)}
            className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative space-y-2 px-4 py-4">
          <ShareAction
            icon={MessageCircle}
            title="WhatsApp"
            subtitle={t("share.whatsappSubtitle")}
            onClick={() => void openTarget(buildWhatsAppShareUrl(payload))}
          />
          <ShareAction
            icon={Send}
            title="Telegram"
            subtitle={t("share.telegramSubtitle")}
            onClick={() => void openTarget(buildTelegramShareUrl(payload))}
          />
          {isNative ? (
            <ShareAction
              icon={instagramBusy ? Loader2 : Camera}
              title={t("share.instagramStory")}
              subtitle={
                instagramAvailable
                  ? t("share.instagramAvailable")
                  : t("share.instagramUnavailable")
              }
              disabled={!instagramAvailable || instagramBusy}
              spinning={instagramBusy}
              onClick={() => void shareToInstagram()}
            />
          ) : null}
          <ShareAction
            icon={Copy}
            title={t("share.copyLink")}
            subtitle={shareText}
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
      <img
        src={payload.imageUrl}
        alt=""
        className="h-14 w-14 shrink-0 rounded-xl border border-white/10 object-cover shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
      />
    );
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
      <span className="text-lg font-black">C</span>
    </div>
  );
}

function ShareAction({
  icon: Icon,
  title,
  subtitle,
  disabled = false,
  spinning = false,
  onClick,
}: {
  icon: typeof Copy;
  title: string;
  subtitle: string;
  disabled?: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-left transition",
        "hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        disabled &&
          "cursor-not-allowed opacity-45 hover:border-white/10 hover:bg-black/20",
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur">
        <Icon size={19} className={spinning ? "animate-spin" : ""} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
