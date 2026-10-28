import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Navigate } from "react-router";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { AlbumContent } from "@/pages/AlbumContent";
import { useAlbumPageController } from "@/pages/use-album-page-controller";

export function Album() {
  const page = useAlbumPageController();

  if (page.loading) {
    return <CrateLoader label={page.t("album.loading")} />;
  }

  if (page.error || !page.data) {
    return (
      <ErrorState
        kind={page.status === 404 || !page.error ? "notFound" : "error"}
        message={
          page.status === 404 || !page.error
            ? page.t("album.notFound")
            : page.error
        }
        onRetry={page.error && page.status !== 404 ? page.refetch : undefined}
        retryLabel={page.t("common.retry")}
      />
    );
  }

  if (page.canonicalPath && page.locationPath !== page.canonicalPath) {
    return <Navigate to={page.canonicalPath} replace />;
  }

  const data = page.data;
  return <AlbumContent page={{ ...page, data }} />;
}
