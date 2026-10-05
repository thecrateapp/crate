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

  if (!page.data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-text-muted">{page.t("playlist.notFound")}</p>
      </div>
    );
  }

  return <CuratedPlaylistContent page={page} />;
}
