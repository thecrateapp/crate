import { Navigate } from "react-router";

import { ArtistReadState } from "@/components/artist/ArtistReadState";
import { ArtistContent } from "@/pages/ArtistContent";
import { useArtistPageController } from "@/pages/use-artist-page-controller";

export function Artist() {
  const page = useArtistPageController();

  if (!page.page || page.status === 404) {
    return (
      <ArtistReadState
        loading={page.loading}
        error={page.error}
        status={page.status}
        onRetry={page.refetch}
      />
    );
  }

  if (page.canonicalPath && page.locationPath !== page.canonicalPath) {
    return <Navigate to={page.canonicalPath} replace />;
  }

  return <ArtistContent page={{ ...page, page: page.page }} />;
}
