package app.cratemusic.crate;

import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Sits under the authorizing {@code ResolvingDataSource}, so it sees the
 * Authorization header the service attached. When the server refuses a
 * request made with the native device token (401/403, for example after the
 * token was revoked from another client while the session lives on), it
 * reports that token so the service can clear the profile and JS can mint a
 * new one. Streams, the prefetcher and artwork all go through it.
 */
@OptIn(markerClass = UnstableApi.class)
final class DeviceTokenRejectionDataSource implements DataSource {
    interface Listener {
        void onDeviceTokenRejected(String deviceToken);
    }

    static final class Factory implements DataSource.Factory {
        private final DataSource.Factory upstream;
        private final Listener listener;

        Factory(DataSource.Factory upstream, Listener listener) {
            this.upstream = upstream;
            this.listener = listener;
        }

        @Override
        public DataSource createDataSource() {
            return new DeviceTokenRejectionDataSource(upstream.createDataSource(), listener);
        }
    }

    private final DataSource upstream;
    private final Listener listener;

    DeviceTokenRejectionDataSource(DataSource upstream, Listener listener) {
        this.upstream = upstream;
        this.listener = listener;
    }

    @Nullable
    static Integer httpStatus(@Nullable Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) current).responseCode;
            }
            if (current.getCause() == current) break;
            current = current.getCause();
        }
        return null;
    }

    @Nullable
    static String authorizationHeader(DataSpec dataSpec) {
        for (Map.Entry<String, String> header : dataSpec.httpRequestHeaders.entrySet()) {
            if ("Authorization".equalsIgnoreCase(header.getKey())) return header.getValue();
        }
        return null;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        try {
            return upstream.open(dataSpec);
        } catch (IOException error) {
            String rejected = NativeStreamAuthorization.rejectedDeviceToken(
                httpStatus(error),
                authorizationHeader(dataSpec)
            );
            if (rejected != null) listener.onDeviceTokenRejected(rejected);
            throw error;
        }
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        return upstream.read(buffer, offset, length);
    }

    @Nullable
    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }

    @Override
    public void close() throws IOException {
        upstream.close();
    }
}
