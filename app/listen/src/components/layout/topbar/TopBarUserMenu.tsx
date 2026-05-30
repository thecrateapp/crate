import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  LogOut,
  Radio,
  Send,
  Settings,
  Upload,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AppMenuButton,
  AppPopover,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestArtist, setSuggestArtist] = useState("");
  const [suggestUrl, setSuggestUrl] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  useDismissibleLayer({
    active: showUserMenu && isDesktop,
    refs: [userMenuRef, userMenuButtonRef],
    onDismiss: () => setShowUserMenu(false),
  });

  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;
  const profilePath = user?.username ? `/users/${user.username}` : "/settings";
  const suggestArtistName = suggestArtist.trim();
  const suggestArtistError =
    suggestArtistName.length > 0 && suggestArtistName.length < 2
      ? "Use at least 2 characters."
      : null;
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(
    user?.avatar,
    user?.id,
  );

  function go(path: string) {
    setShowUserMenu(false);
    navigate(path);
  }

  function openSuggestArtist() {
    setShowUserMenu(false);
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
      toast.success("Artist suggestion sent");
      setSuggestArtist("");
      setSuggestUrl("");
      setSuggestNote("");
      setSuggestOpen(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not send suggestion",
      );
    } finally {
      setSuggesting(false);
    }
  }

  const menuContent = (
    <>
      <div className="px-3 pb-2 pt-2">
        <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              onError={handleAvatarError}
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-white/60">
              {userInitial || <User size={14} />}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-white/85 truncate">
              {userName || "Signed in"}
            </p>
            {user?.email ? (
              <p className="truncate text-[10px] text-muted-foreground">
                {user.email}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <AppPopoverDivider />
      <AppMenuButton
        onClick={() => go(profilePath)}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <User size={14} /> Profile
      </AppMenuButton>
      <AppMenuButton
        onClick={() => go("/people")}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <Users size={14} /> People
      </AppMenuButton>
      <AppMenuButton
        onClick={() => go("/jam")}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <Radio size={14} /> Jam sessions
      </AppMenuButton>
      <AppMenuButton
        onClick={() => go("/upload")}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <Upload size={14} /> Upload music
      </AppMenuButton>
      <AppMenuButton
        onClick={openSuggestArtist}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <UserPlus size={14} /> Suggest an artist
      </AppMenuButton>
      {isDesktop ? (
        <AppMenuButton
          onClick={() => go("/stats")}
          className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
        >
          <BarChart3 size={14} /> Stats
        </AppMenuButton>
      ) : null}
      <AppMenuButton
        onClick={() => go("/settings")}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:text-white"
      >
        <Settings size={14} /> Settings
      </AppMenuButton>
      <AppPopoverDivider />
      <AppMenuButton
        onClick={() => {
          setShowUserMenu(false);
          void logout();
        }}
        className="min-h-11 gap-2.5 px-3 py-2 text-[13px]"
        danger
      >
        <LogOut size={14} /> Sign out
      </AppMenuButton>
    </>
  );

  return (
    <>
      <div className="relative pointer-events-auto">
        <button
          ref={userMenuButtonRef}
          onClick={() => setShowUserMenu(!showUserMenu)}
          aria-label="User menu"
          className="flex h-12 w-12 touch-manipulation items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30 text-sm font-medium text-white/70 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              onError={handleAvatarError}
              className="h-full w-full object-cover"
            />
          ) : (
            userInitial || <User size={18} />
          )}
        </button>

        {showUserMenu && isDesktop && (
          <AppPopover
            ref={userMenuRef}
            className="absolute right-0 top-full mt-2 w-60 py-1"
          >
            {menuContent}
          </AppPopover>
        )}
      </div>

      {showUserMenu &&
        !isDesktop &&
        createPortal(
          <AppModal
            open={showUserMenu}
            onClose={() => setShowUserMenu(false)}
            maxWidthClassName="sm:max-w-sm"
          >
            <ModalBody className="py-2">{menuContent}</ModalBody>
          </AppModal>,
          document.body,
        )}

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
                      Acquisition
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      Suggest an artist
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Send a request to the Crate admins so they can search and
                      acquire it.
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
                    Artist
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
                    Link, if you have one
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
                    Note
                  </span>
                  <textarea
                    value={suggestNote}
                    onChange={(event) => setSuggestNote(event.target.value)}
                    placeholder="Why should this be in Crate?"
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
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={suggesting || suggestArtistName.length < 2}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={14} />
                  {suggesting ? "Sending..." : "Send suggestion"}
                </button>
              </ModalFooter>
            </form>
          </AppModal>,
          document.body,
        )}
    </>
  );
}
