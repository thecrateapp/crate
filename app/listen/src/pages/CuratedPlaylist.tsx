import { ErrorState } from "@crate/ui/primitives/ErrorState";

import { CuratedPlaylistContent } from "@/pages/CuratedPlaylistContent";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { useCuratedPlaylistPageController } from "@/pages/use-curated-playlist-page-controller";

export function CuratedPlaylist() {
  const page = useCuratedPlaylistPageController();

  if (page.loading) {
    return <CrateLoader label={page.t("playlist.loading")} />;
  }

  if (!page.data && page.error && page.status !== 404) {
    return (
      <ErrorState
        message={page.t("playlist.toasts.loadFailed")}
        onRetry={page.refetch}
        retryLabel={page.t("common.retry")}
      />
    );
  }

  if (!page.data)
    return <ErrorState kind="notFound" title={page.t("playlist.notFound")} />;

  return <CuratedPlaylistContent page={page} />;
}
