package app.cratemusic.crate;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.ByteArrayDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class NativeStreamPrefetcherTest {
    private static final String TRACK = "https://api.example.test/api/tracks/7/stream?media_ticket=abc";
    private static final byte[] AUDIO = new byte[64 * 1024];

    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    private SimpleCache cache;
    private NativeStreamCache.Prefetcher prefetcher;

    /** A server answer: fixed bytes plus the variant status header. */
    private static final class FakeServer implements DataSource {
        private final ByteArrayDataSource body = new ByteArrayDataSource(AUDIO);
        private final String variantStatus;

        FakeServer(String variantStatus) {
            this.variantStatus = variantStatus;
        }

        @Override
        public void addTransferListener(TransferListener transferListener) {}

        @Override
        public long open(DataSpec dataSpec) throws IOException {
            return body.open(dataSpec);
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            return body.read(buffer, offset, length);
        }

        @Nullable
        @Override
        public Uri getUri() {
            return body.getUri();
        }

        @Override
        public Map<String, List<String>> getResponseHeaders() {
            return Collections.singletonMap(
                StableStreamResponseDataSource.VARIANT_STATUS_HEADER,
                Collections.singletonList(variantStatus)
            );
        }

        @Override
        public void close() {
            body.close();
        }
    }

    @Before
    public void setUp() throws IOException {
        cache = new SimpleCache(
            folder.newFolder("stream-cache"),
            new NoOpCacheEvictor(),
            new StandaloneDatabaseProvider(RuntimeEnvironment.getApplication())
        );
    }

    @After
    public void tearDown() {
        if (prefetcher != null) prefetcher.release();
        cache.release();
    }

    private String key() {
        return NativeStreamCacheKeys.keyFor(Uri.parse(TRACK));
    }

    private boolean waitUntilCached(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (NativeStreamCache.isFullyCached(cache, key())) return true;
            Thread.sleep(20);
        }
        return NativeStreamCache.isFullyCached(cache, key());
    }

    @Test
    public void downloadsAWholeTrackForOfflinePlayback() throws InterruptedException {
        prefetcher = new NativeStreamCache.Prefetcher(cache, () -> new FakeServer("ready"));

        prefetcher.prefetch(Collections.singletonList(TRACK));

        assertTrue(waitUntilCached(5_000));
    }

    @Test
    public void neverStoresAVariantThatIsStillPreparing() throws InterruptedException {
        prefetcher = new NativeStreamCache.Prefetcher(cache, () -> new FakeServer("preparing"));

        prefetcher.prefetch(Collections.singletonList(TRACK));

        assertFalse(waitUntilCached(500));
        assertTrue(cache.getCachedSpans(key()).isEmpty());
    }

    @Test
    public void skipsLocalFiles() throws InterruptedException {
        boolean[] opened = new boolean[1];
        prefetcher = new NativeStreamCache.Prefetcher(cache, () -> {
            opened[0] = true;
            return new FakeServer("ready");
        });

        prefetcher.prefetch(Collections.singletonList("file:///data/offline/7.flac"));
        Thread.sleep(200);

        assertFalse(opened[0]);
    }
}
