import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Share2 } from "@crate/ui/icons";

import { SECONDARY_ACTION_CLASS } from "@/components/album/album-action-types";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  CrateCoverFlow,
  type CrateCoverUrl,
} from "@/components/crates/CrateCoverFlow";
import {
  crateOwnerName,
  isShareableCrate,
  type NumberedCrateAlbum,
} from "@/components/crates/crate-model";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { cn } from "@/lib/utils";
import { UserProfileAvatar } from "@/pages/UserProfileAvatar";
import type { CrateDetail } from "@/pages/crates-types";

export function CrateHero({
  crate,
  albums,
  coverUrl,
  followerCount,
  className,
}: {
  crate: CrateDetail;
  albums: NumberedCrateAlbum[];
  coverUrl: CrateCoverUrl;
  followerCount: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const ownerName = crateOwnerName(crate) ?? t("people.unknownUser");
  const backgroundAlbum = albums.find((album) => album.has_cover);
  const backgroundUrl = backgroundAlbum ? coverUrl(backgroundAlbum, 512) : null;
  const meta = [
    t("common.albumCountLabel", { count: albums.length }),
    crate.track_count > 0
      ? t("common.trackCountLabel", { count: crate.track_count })
      : null,
    followerCount > 0
      ? t("common.followerCountLabel", { count: followerCount })
      : null,
  ].filter(Boolean);
  const ownerLine = (
    <>
      <UserProfileAvatar
        name={ownerName}
        avatar={crate.owner_avatar}
        userId={crate.owner_id}
        className="size-6 shrink-0 text-xs!"
      />
      {t("crate.page.kicker", { name: ownerName })}
    </>
  );

  return (
    <section data-testid="crate-hero" className="relative overflow-hidden">
      {backgroundUrl ? (
        <CrateImage
          data-testid="crate-hero-background"
          src={backgroundUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full scale-125 object-cover opacity-90 blur-2xl brightness-[0.8] saturate-150 sm:opacity-80 sm:brightness-[0.6]"
        />
      ) : null}
      <div className="absolute inset-0 bg-surface-canvas/10 sm:bg-surface-canvas/32" />
      <div
        className="absolute inset-0 sm:hidden"
        style={{ background: "var(--hero-artwork-gradient-mobile)" }}
      />
      <div
        className="absolute inset-0 hidden sm:block"
        style={{ background: "var(--hero-artwork-gradient-desktop)" }}
      />
      <div
        className={cn(
          "relative mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 pb-6 sm:px-6 lg:flex-row lg:items-end lg:gap-10",
          className,
        )}
      >
        <div className="w-full lg:w-[58%] lg:max-w-[720px] lg:shrink-0">
          <CrateCoverFlow
            albums={albums}
            isOrdered={crate.is_ordered}
            crateName={crate.name}
            loopEnabled={crate.loop_enabled}
            coverUrl={coverUrl}
          />
        </div>
        <div
          data-testid="crate-hero-info"
          className="flex min-w-0 flex-col justify-end text-left lg:pb-14"
        >
          <h1 className="mb-1.5 max-w-4xl break-words text-2xl font-bold text-text-primary sm:text-4xl">
            {crate.name}
          </h1>
          {crate.owner_username ? (
            <UserProfileLink
              username={crate.owner_username}
              className="mb-3 inline-flex items-center gap-2 self-start text-sm text-text-muted transition-colors hover:text-accent-action"
            >
              {ownerLine}
            </UserProfileLink>
          ) : (
            <p className="mb-3 inline-flex items-center gap-2 self-start text-sm text-text-muted">
              {ownerLine}
            </p>
          )}
          <p className="text-sm text-text-muted">{meta.join(" · ")}</p>
          {crate.description ? (
            <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-text-muted line-clamp-4">
              {crate.description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function CrateActionRow({
  primary,
  secondary,
  footer,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      data-testid="crate-action-row"
      className="relative z-10 p-4 pb-4 pt-0 sm:px-0"
    >
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
        {primary}
        {secondary}
      </div>
      {footer ? (
        <div className="mx-auto mt-3 w-full max-w-[1480px] sm:px-6">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function CrateSecondaryActions({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("crate.page.secondaryActions")}
      className="grid grid-flow-col auto-cols-fr items-start md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
    >
      {children}
    </div>
  );
}

export function CrateSecondaryAction({
  icon,
  label,
  className,
  buttonRef,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className={cn(
        SECONDARY_ACTION_CLASS,
        "min-w-0 px-0 md:px-1.5",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

export function CrateShareAction({
  crate,
  onShare,
}: {
  crate: CrateDetail;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  const shareable = isShareableCrate(crate);
  const label = shareable
    ? t("crate.page.share")
    : t("crate.page.sharePrivateHint");

  return (
    <span title={label} className="flex min-w-0 justify-center">
      <CrateSecondaryAction
        icon={<Share2 size={CRATE_ICON_SIZE.lg} />}
        label={t("common.share")}
        aria-label={label}
        disabled={!shareable}
        onClick={onShare}
      />
    </span>
  );
}
