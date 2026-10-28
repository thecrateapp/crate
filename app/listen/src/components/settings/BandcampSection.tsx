import { CrateImage } from "@/components/artwork/CrateImage";
import { BandcampSettingsView } from "./BandcampSettingsView";
import { useBandcampConnection } from "./use-bandcamp-connection";
export function BandcampSection() {
  const connection = useBandcampConnection();
  return (
    <BandcampSettingsView
      {...connection}
      renderImage={(props) => <CrateImage {...props} retryPolicy="none" />}
      loading={connection.loading}
      loadError={connection.loadError}
      onRetry={() => void connection.loadBandcamp().catch(() => {})}
      onRetryCounts={() => void connection.loadBandcampCounts()}
      onSync={() => void connection.syncBandcamp()}
      onDisconnect={() => void connection.disconnectBandcamp()}
      onOpenDesktop={() => void connection.openTauriBandcampInterceptor()}
      onConnect={(cookie) => void connection.connectWithCookie(cookie)}
    />
  );
}
