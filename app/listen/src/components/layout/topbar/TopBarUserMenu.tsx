import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CRATE_ICON_SIZE,
  LogOut,
  Send,
  Settings,
  Upload,
  User,
  UserPlus,
  Users,
} from "@crate/ui/icons";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  ContextMenu,
  type ContextMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

function useArtistSuggestionController() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const artistName = artist.trim();
  const error =
    artistName.length > 0 && artistName.length < 2
      ? t("userMenu.suggest.validation.minChars")
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (artistName.length < 2) return;
    setSending(true);
    try {
      await api("/api/me/artist-suggestions", "POST", {
        artist_name: artistName,
        artist_url: url.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(t("userMenu.suggest.toasts.sent"));
      setArtist("");
      setUrl("");
      setNote("");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("userMenu.suggest.toasts.failed"),
      );
    } finally {
      setSending(false);
    }
  }

  return {
    open,
    artist,
    url,
    note,
    sending,
    artistName,
    error,
    openModal: () => setOpen(true),
    closeModal: () => setOpen(false),
    setArtist,
    setUrl,
    setNote,
    submit,
  };
}

function buildUserMenuItems({
  isDesktop,
  onSuggestArtist,
  profilePath,
  navigate,
  logout,
  t,
}: {
  isDesktop: boolean;
  onSuggestArtist: () => void;
  profilePath: string;
  navigate: (path: string) => void;
  logout: () => Promise<void> | void;
  t: ReturnType<typeof useTranslation>["t"];
}): ContextMenuEntry[] {
  const go = (path: string) => navigate(path);
  return [
    {
      key: "profile",
      label: t("userMenu.profile"),
      icon: User,
      onSelect: () => go(profilePath),
    },
    {
      key: "people",
      label: t("userMenu.people"),
      icon: Users,
      onSelect: () => go("/people"),
    },
    {
      key: "upload",
      label: t("userMenu.uploadMusic"),
      icon: Upload,
      onSelect: () => go("/upload"),
    },
    {
      key: "suggest-artist",
      label: t("userMenu.suggestArtist"),
      icon: UserPlus,
      onSelect: onSuggestArtist,
    },
    ...(isDesktop
      ? [
          {
            key: "stats",
            label: t("userMenu.stats"),
            icon: BarChart3,
            onSelect: () => go("/stats"),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "settings",
      label: t("userMenu.settings"),
      icon: Settings,
      onSelect: () => go("/settings"),
    },
    { type: "divider", key: "account-divider" },
    {
      key: "logout",
      label: t("userMenu.signOut"),
      icon: LogOut,
      danger: true,
      onSelect: () => {
        void logout();
      },
    },
  ];
}

function UserMenuAvatarButton({
  actionMenu,
  avatarUrl,
  handleAvatarError,
  initial,
  t,
}: {
  actionMenu: ReturnType<typeof useItemActionMenu>;
  avatarUrl: string | null;
  handleAvatarError: () => void;
  initial: string | null;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="relative pointer-events-auto">
      <button
        type="button"
        ref={actionMenu.triggerRef}
        onClick={actionMenu.openFromTrigger}
        onContextMenu={actionMenu.handleContextMenu}
        onKeyDown={actionMenu.handleKeyboardTrigger}
        aria-expanded={actionMenu.open}
        aria-haspopup="menu"
        aria-label={t("userMenu.label")}
        className="flex h-12 w-12 touch-manipulation items-center justify-center overflow-hidden rounded-full border border-border-quiet bg-surface-canvas/30 text-sm font-medium text-text-primary/70 shadow-icon-control backdrop-blur-sm transition-colors hover:bg-surface-canvas/50 hover:text-text-primary"
        {...actionMenu.longPressHandlers}
      >
        {avatarUrl ? (
          <CrateImage
            src={avatarUrl}
            alt=""
            onError={handleAvatarError}
            className="h-full w-full object-cover"
          />
        ) : (
          initial || <User size={CRATE_ICON_SIZE.lg} />
        )}
      </button>
    </div>
  );
}

function ArtistSuggestionModal({
  controller,
}: {
  controller: ReturnType<typeof useArtistSuggestionController>;
}) {
  const { t } = useTranslation();
  if (!controller.open || typeof document === "undefined") return null;

  return createPortal(
    <AppModal
      open={controller.open}
      onClose={controller.closeModal}
      maxWidthClassName="sm:max-w-md"
    >
      <form onSubmit={controller.submit}>
        <ModalHeader className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent-action">
                {t("userMenu.suggest.badge")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-text-primary">
                {t("userMenu.suggest.title")}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {t("userMenu.suggest.description")}
              </p>
            </div>
            <ModalCloseButton
              onClick={controller.closeModal}
              disabled={controller.sending}
            />
          </div>
        </ModalHeader>
        <ModalBody className="space-y-4 px-5 py-5">
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.artistLabel")}
            </span>
            <input
              value={controller.artist}
              onChange={(event) => controller.setArtist(event.target.value)}
              placeholder="High Vis, Denzel Curry, ..."
              aria-invalid={controller.error ? true : undefined}
              aria-describedby={
                controller.error ? "artist-suggestion-error" : undefined
              }
              className="h-11 w-full rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              required
              minLength={2}
              maxLength={200}
            />
            {controller.error ? (
              <span
                id="artist-suggestion-error"
                className="block text-xs text-state-danger-text"
              >
                {controller.error}
              </span>
            ) : null}
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.linkLabel")}
            </span>
            <input
              value={controller.url}
              onChange={(event) => controller.setUrl(event.target.value)}
              placeholder="Bandcamp, Tidal, Spotify, YouTube..."
              className="h-11 w-full rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              maxLength={500}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-primary/45">
              {t("userMenu.suggest.noteLabel")}
            </span>
            <textarea
              value={controller.note}
              onChange={(event) => controller.setNote(event.target.value)}
              placeholder={t("userMenu.suggest.notePlaceholder")}
              className="min-h-24 w-full resize-none rounded-md border border-border-quiet bg-text-primary/[0.04] px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/60"
              maxLength={1000}
            />
          </label>
        </ModalBody>
        <ModalFooter className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={controller.closeModal}
            className="rounded-lg border border-border-quiet px-4 py-2 text-sm text-text-primary/65 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            disabled={controller.sending}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={controller.sending || controller.artistName.length < 2}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2 text-sm font-semibold text-accent-action-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={CRATE_ICON_SIZE.sm} />
            {controller.sending
              ? t("userMenu.suggest.sending")
              : t("userMenu.suggest.submit")}
          </button>
        </ModalFooter>
      </form>
    </AppModal>,
    document.body,
  );
}

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const suggestion = useArtistSuggestionController();
  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;
  const profilePath = user?.username ? `/users/${user.username}` : "/settings";
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(
    user?.avatar,
    user?.id,
  );
  const menuItems = buildUserMenuItems({
    isDesktop,
    onSuggestArtist: suggestion.openModal,
    profilePath,
    navigate,
    logout,
    t,
  });
  const actionMenu = useItemActionMenu(menuItems);

  return (
    <>
      <UserMenuAvatarButton
        actionMenu={actionMenu}
        avatarUrl={avatarUrl}
        handleAvatarError={handleAvatarError}
        initial={userInitial}
        t={t}
      />
      <ContextMenu
        header={{
          type: "media",
          title: userName || t("userMenu.signedIn"),
          subtitle: user?.email ?? undefined,
          imageUrl: avatarUrl,
          imageAlt: userName || t("userMenu.userImageAlt"),
          imageOnError: handleAvatarError,
          imageShape: "circle",
          fallbackIcon: User,
        }}
        items={menuItems}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
      <ArtistSuggestionModal controller={suggestion} />
    </>
  );
}
