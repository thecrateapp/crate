import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CRATE_ICON_SIZE,
  LogOut,
  Radio,
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
import { AuthenticatedMediaImage } from "@/components/player/AuthenticatedMediaImage";
import {
  ContextMenu,
  type ContextMenuEntry,
  useItemActionMenu,
} from "@crate/ui/domain/actions";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestArtist, setSuggestArtist] = useState("");
  const [suggestUrl, setSuggestUrl] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;
  const profilePath = user?.username ? `/users/${user.username}` : "/settings";
  const suggestArtistName = suggestArtist.trim();
  const suggestArtistError =
    suggestArtistName.length > 0 && suggestArtistName.length < 2
      ? t("userMenu.suggest.validation.minChars")
      : null;
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(
    user?.avatar,
    user?.id,
  );

  function go(path: string) {
    navigate(path);
  }

  function openSuggestArtist() {
    setSuggestOpen(true);
  }

  async function submitArtistSuggestion(event: FormEvent) {
    event.preventDefault();
    const artistName = suggestArtist.trim();
    if (artistName.length < 2) return;
    setSuggesting(true);
    try {
      await api("/api/me/artist-suggestions", "POST", {
        artist_name: artistName,
        artist_url: suggestUrl.trim() || undefined,
        note: suggestNote.trim() || undefined,
      });
      toast.success(t("userMenu.suggest.toasts.sent"));
      setSuggestArtist("");
      setSuggestUrl("");
      setSuggestNote("");
      setSuggestOpen(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("userMenu.suggest.toasts.failed"),
      );
    } finally {
      setSuggesting(false);
    }
  }

  const menuItems: ContextMenuEntry[] = [
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
      key: "jam",
      label: t("userMenu.jamSessions"),
      icon: Radio,
      onSelect: () => go("/jam"),
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
      onSelect: openSuggestArtist,
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
  const actionMenu = useItemActionMenu(menuItems);

  return (
    <>
      <div className="relative pointer-events-auto">
        <button
          ref={actionMenu.triggerRef}
          onClick={actionMenu.openFromTrigger}
          onContextMenu={actionMenu.handleContextMenu}
          onKeyDown={actionMenu.handleKeyboardTrigger}
          aria-expanded={actionMenu.open}
          aria-haspopup="menu"
          aria-label={t("userMenu.label")}
          className="flex h-12 w-12 touch-manipulation items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30 text-sm font-medium text-white/70 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
          {...actionMenu.longPressHandlers}
        >
          {avatarUrl ? (
            <AuthenticatedMediaImage
              src={avatarUrl}
              alt=""
              onError={handleAvatarError}
              className="h-full w-full object-cover"
            />
          ) : (
            userInitial || <User size={CRATE_ICON_SIZE.lg} />
          )}
        </button>
      </div>

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

      {suggestOpen &&
        createPortal(
          <AppModal
            open={suggestOpen}
            onClose={() => setSuggestOpen(false)}
            maxWidthClassName="sm:max-w-md"
          >
            <form onSubmit={submitArtistSuggestion}>
              <ModalHeader className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                      {t("userMenu.suggest.badge")}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {t("userMenu.suggest.title")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("userMenu.suggest.description")}
                    </p>
                  </div>
                  <ModalCloseButton
                    onClick={() => setSuggestOpen(false)}
                    disabled={suggesting}
                  />
                </div>
              </ModalHeader>
              <ModalBody className="space-y-4 px-5 py-5">
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
                    {t("userMenu.suggest.artistLabel")}
                  </span>
                  <input
                    value={suggestArtist}
                    onChange={(event) => setSuggestArtist(event.target.value)}
                    placeholder="High Vis, Denzel Curry, ..."
                    aria-invalid={suggestArtistError ? true : undefined}
                    aria-describedby={
                      suggestArtistError ? "artist-suggestion-error" : undefined
                    }
                    className="h-11 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-primary/60"
                    required
                    minLength={2}
                    maxLength={200}
                  />
                  {suggestArtistError ? (
                    <span
                      id="artist-suggestion-error"
                      className="block text-xs text-red-300"
                    >
                      {suggestArtistError}
                    </span>
                  ) : null}
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
                    {t("userMenu.suggest.linkLabel")}
                  </span>
                  <input
                    value={suggestUrl}
                    onChange={(event) => setSuggestUrl(event.target.value)}
                    placeholder="Bandcamp, Tidal, Spotify, YouTube..."
                    className="h-11 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-primary/60"
                    maxLength={500}
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
                    {t("userMenu.suggest.noteLabel")}
                  </span>
                  <textarea
                    value={suggestNote}
                    onChange={(event) => setSuggestNote(event.target.value)}
                    placeholder={t("userMenu.suggest.notePlaceholder")}
                    className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-primary/60"
                    maxLength={1000}
                  />
                </label>
              </ModalBody>
              <ModalFooter className="flex justify-end gap-2 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setSuggestOpen(false)}
                  className="rounded-md border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:bg-white/5 hover:text-white"
                  disabled={suggesting}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={suggesting || suggestArtistName.length < 2}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={CRATE_ICON_SIZE.sm} />
                  {suggesting
                    ? t("userMenu.suggest.sending")
                    : t("userMenu.suggest.submit")}
                </button>
              </ModalFooter>
            </form>
          </AppModal>,
          document.body,
        )}
    </>
  );
}
