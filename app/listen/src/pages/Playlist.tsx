import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { PlaylistContent } from "@/pages/PlaylistContent";
import { useAuth } from "@/contexts/AuthContext";
import { usePlaylistPageController } from "@/pages/use-playlist-page-controller";

export function Playlist() {
  const page = usePlaylistPageController();
  const { user } = useAuth();

  if (page.loading) {
    return <CrateLoader label={page.t("playlist.loading")} />;
  }

  if (!page.data && page.error && page.status !== 404)
    return (
      <ErrorState
        message={page.t("playlist.toasts.loadFailed")}
        retryLabel={page.t("common.retry")}
        onRetry={page.refetch}
      />
    );
  if (!page.data)
    return <ErrorState kind="notFound" title={page.t("playlist.notFound")} />;

  return <PlaylistContent page={{ ...page, data: page.data }} user={user} />;
}
