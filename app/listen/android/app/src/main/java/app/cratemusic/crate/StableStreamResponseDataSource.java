package app.cratemusic.crate;

import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheKeyFactory;
import androidx.media3.datasource.cache.ContentMetadata;
import androidx.media3.datasource.cache.ContentMetadataMutations;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The upstream of the prefetch cache writer: lets a response into the cache
 * only when its bytes will be the same next time.
 *
 * <p>While a transcoded variant is still being prepared the server answers the
 * same URL with the original file (or another variant), then with the variant
 * once it is ready. Caching both under one key would splice two encodings into
 * one corrupt file, so a response whose {@code X-Crate-Variant-Status} is not
 * empty or {@code ready} fails here and nothing of it is written. A complete
 * response whose length differs from the copy already cached also fails, and
 * that copy is dropped.
 */
@OptIn(markerClass = UnstableApi.class)
final class StableStreamResponseDataSource implements DataSource {
    static final String VARIANT_STATUS_HEADER = "X-Crate-Variant-Status";

    interface StoredLengths {
        /** The full length cached for {@code key}, or {@link C#LENGTH_UNSET}. */
        long get(String key);

        /** Drops every cached byte and the stored length of {@code key}. */
        void discard(String key);
    }

    static final class UnstableResponseException extends IOException {
        UnstableResponseException(String message) {
            super(message);
        }
    }

    static StoredLengths storedLengthsOf(Cache cache) {
        return new StoredLengths() {
            @Override
            public long get(String key) {
                return ContentMetadata.getContentLength(cache.getContentMetadata(key));
            }

            @Override
            public void discard(String key) {
                cache.removeResource(key);
                ContentMetadataMutations mutations = new ContentMetadataMutations();
                ContentMetadataMutations.setContentLength(mutations, C.LENGTH_UNSET);
                try {
                    cache.applyContentMetadataMutations(key, mutations);
                } catch (Cache.CacheException ignored) {
                    // The spans are gone; a stale length only stops the next prefetch.
                }
            }
        };
    }

    private final DataSource upstream;
    private final CacheKeyFactory keyFactory;
    private final StoredLengths storedLengths;

    StableStreamResponseDataSource(
        DataSource upstream,
        CacheKeyFactory keyFactory,
        StoredLengths storedLengths
    ) {
        this.upstream = upstream;
        this.keyFactory = keyFactory;
        this.storedLengths = storedLengths;
    }

    static boolean isStableResponse(Map<String, List<String>> headers) {
        if (headers == null) return true;
        for (Map.Entry<String, List<String>> header : headers.entrySet()) {
            if (
                header.getKey() == null ||
                !VARIANT_STATUS_HEADER.equalsIgnoreCase(header.getKey())
            ) {
                continue;
            }
            List<String> values = header.getValue();
            String status = values == null || values.isEmpty() ? "" : values.get(0);
            status = status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
            return status.isEmpty() || "ready".equals(status);
        }
        return true;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        long length = upstream.open(dataSpec);
        if (!isStableResponse(upstream.getResponseHeaders())) {
            closeQuietly();
            throw new UnstableResponseException("Stream variant is still being prepared");
        }
        if (dataSpec.length == C.LENGTH_UNSET && length != C.LENGTH_UNSET) {
            String key = keyFactory.buildCacheKey(dataSpec);
            long stored = storedLengths.get(key);
            long total = dataSpec.position + length;
            if (stored != C.LENGTH_UNSET && stored != total) {
                closeQuietly();
                storedLengths.discard(key);
                throw new UnstableResponseException("Cached stream differs from the server copy");
            }
        }
        return length;
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

    private void closeQuietly() {
        try {
            upstream.close();
        } catch (IOException ignored) {
            // The response is being refused anyway.
        }
    }
}
