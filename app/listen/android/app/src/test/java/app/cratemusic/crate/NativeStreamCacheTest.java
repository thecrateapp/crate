package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class NativeStreamCacheTest {
    private static final String API = "https://api.example.test";

    private static String key(String url) {
        return NativeStreamCacheKeys.INSTANCE.buildCacheKey(new DataSpec(Uri.parse(url)));
    }

    // --- cache keys ---

    @Test
    public void theKeyIgnoresRotatingCredentials() {
        assertEquals(
            key(API + "/api/tracks/by-entity/abc/stream?media_ticket=one"),
            key(API + "/api/tracks/by-entity/abc/stream?media_ticket=two&token=x")
        );
    }

    @Test
    public void theKeyKeepsTheQualityAndTheTrack() {
        String original = key(API + "/api/tracks/by-entity/abc/stream");
        String balanced = key(API + "/api/tracks/by-entity/abc/stream?delivery=balanced");
        String other = key(API + "/api/tracks/by-entity/def/stream");

        assertNotEquals(original, balanced);
        assertNotEquals(original, other);
        assertEquals(
            key(API + "/api/stream/a?delivery=balanced&x=1"),
            key(API + "/api/stream/a?x=1&delivery=balanced&media_ticket=t")
        );
    }

    @Test
    public void anExplicitKeyWins() {
        DataSpec spec = new DataSpec.Builder()
            .setUri(Uri.parse(API + "/api/tracks/1/stream"))
            .setKey("pinned")
            .build();

        assertEquals("pinned", NativeStreamCacheKeys.INSTANCE.buildCacheKey(spec));
    }

    @Test
    public void onlyNetworkStreamsArePrefetched() {
        assertTrue(NativeStreamCacheKeys.isNetworkStream(API + "/api/tracks/1/stream"));
        assertTrue(NativeStreamCacheKeys.isNetworkStream("http://10.0.2.2:8585/api/tracks/1/stream"));
        assertFalse(NativeStreamCacheKeys.isNetworkStream("file:///data/offline/a.flac"));
        assertFalse(NativeStreamCacheKeys.isNetworkStream("content://media/1"));
        assertFalse(NativeStreamCacheKeys.isNetworkStream(""));
    }

    // --- stable responses ---

    private static Map<String, List<String>> headers(String... pairs) {
        Map<String, List<String>> headers = new HashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            headers.put(pairs[index], Collections.singletonList(pairs[index + 1]));
        }
        return headers;
    }

    @Test
    public void readyVariantsAndPlainFilesAreStable() {
        assertTrue(StableStreamResponseDataSource.isStableResponse(headers()));
        assertTrue(
            StableStreamResponseDataSource.isStableResponse(
                headers("X-Crate-Variant-Status", "")
            )
        );
        assertTrue(
            StableStreamResponseDataSource.isStableResponse(
                headers("x-crate-variant-status", "ready")
            )
        );
    }

    @Test
    public void aVariantStillPreparingIsNotStable() {
        // The server serves the original (or another variant) under the same
        // URL until the requested variant is ready.
        assertFalse(
            StableStreamResponseDataSource.isStableResponse(
                headers("X-Crate-Variant-Status", "preparing")
            )
        );
        assertFalse(
            StableStreamResponseDataSource.isStableResponse(
                headers("X-Crate-Variant-Status", "running")
            )
        );
    }

    private static final class FakeUpstream implements DataSource {
        private final long length;
        private final Map<String, List<String>> responseHeaders;
        boolean closed;

        FakeUpstream(long length, Map<String, List<String>> responseHeaders) {
            this.length = length;
            this.responseHeaders = responseHeaders;
        }

        @Override
        public void addTransferListener(TransferListener transferListener) {}

        @Override
        public long open(DataSpec dataSpec) {
            return length;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) {
            return C.RESULT_END_OF_INPUT;
        }

        @Nullable
        @Override
        public Uri getUri() {
            return Uri.parse(API + "/api/tracks/1/stream");
        }

        @Override
        public Map<String, List<String>> getResponseHeaders() {
            return responseHeaders;
        }

        @Override
        public void close() {
            closed = true;
        }
    }

    private static final class FakeLengths implements StableStreamResponseDataSource.StoredLengths {
        long stored = C.LENGTH_UNSET;
        final List<String> discarded = new ArrayList<>();

        @Override
        public long get(String key) {
            return stored;
        }

        @Override
        public void discard(String key) {
            discarded.add(key);
        }
    }

    private static DataSpec wholeFile() {
        return new DataSpec.Builder()
            .setUri(Uri.parse(API + "/api/tracks/1/stream"))
            .setKey("track-1")
            .build();
    }

    @Test
    public void refusesToCacheATransientResponse() {
        FakeUpstream upstream = new FakeUpstream(
            1_000L,
            headers("X-Crate-Variant-Status", "preparing")
        );
        StableStreamResponseDataSource guard = new StableStreamResponseDataSource(
            upstream,
            NativeStreamCacheKeys.INSTANCE,
            new FakeLengths()
        );

        assertThrows(IOException.class, () -> guard.open(wholeFile()));
        assertTrue(upstream.closed);
    }

    @Test
    public void dropsACachedCopyOfDifferentBytes() {
        FakeLengths lengths = new FakeLengths();
        lengths.stored = 2_000L;
        StableStreamResponseDataSource guard = new StableStreamResponseDataSource(
            new FakeUpstream(1_000L, headers("X-Crate-Variant-Status", "ready")),
            NativeStreamCacheKeys.INSTANCE,
            lengths
        );

        assertThrows(IOException.class, () -> guard.open(wholeFile()));
        assertEquals(Collections.singletonList("track-1"), lengths.discarded);
    }

    @Test
    public void passesAStableResponseThrough() throws IOException {
        FakeLengths lengths = new FakeLengths();
        lengths.stored = 1_000L;
        StableStreamResponseDataSource guard = new StableStreamResponseDataSource(
            new FakeUpstream(1_000L, headers()),
            NativeStreamCacheKeys.INSTANCE,
            lengths
        );

        assertEquals(1_000L, guard.open(wholeFile()));
        assertTrue(lengths.discarded.isEmpty());
    }

    // --- prefetch plan ---

    @Test
    public void prefetchesTheCurrentAndNextTrack() {
        List<String> urls = Arrays.asList("a", "b", "c", "d");

        assertEquals(
            Arrays.asList("b", "c"),
            NativeStreamPrefetchPlan.select(urls, 1, false)
        );
        assertEquals(
            Arrays.asList("b", "c", "d"),
            NativeStreamPrefetchPlan.select(urls, 1, true)
        );
    }

    @Test
    public void thePlanStopsAtTheEndOfTheQueue() {
        List<String> urls = Arrays.asList("a", "b");

        assertEquals(Collections.singletonList("b"), NativeStreamPrefetchPlan.select(urls, 1, true));
        assertTrue(NativeStreamPrefetchPlan.select(urls, 5, true).isEmpty());
        assertTrue(NativeStreamPrefetchPlan.select(urls, -1, true).isEmpty());
    }
}
