package app.cratemusic.crate;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.cache.Cache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.ContentMetadata;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * An on-disk cache of streamed tracks, so a dropped connection does not stop
 * playback while the current or next track is already downloaded.
 *
 * <p>Only the {@link Prefetcher} writes, through {@link
 * StableStreamResponseDataSource}, and it writes whole tracks. The player reads
 * through the cache and streams whatever is missing without writing it: a
 * transcoded variant that is still being prepared answers with other bytes
 * under the same URL, and the player cannot refuse a response mid-playback the
 * way the prefetcher can.
 *
 * <p>Downloaded (offline) tracks are local files and never pass through here.
 * The cache lives in the app cache directory, so Android may clear it when the
 * device runs out of space.
 */
@OptIn(markerClass = UnstableApi.class)
final class NativeStreamCache {
    private static final String TAG = "CrateStreamCache";
    static final long MAX_CACHE_BYTES = 1024L * 1024L * 1024L;
    /** A track longer than this (a long DJ mix in FLAC) is streamed, not prefetched. */
    static final long MAX_PREFETCH_BYTES = 250L * 1024L * 1024L;
    private static final String DIRECTORY = "crate-stream-cache";

    @Nullable
    private static SimpleCache sharedCache;
    private static boolean sharedCacheFailed;

    private NativeStreamCache() {}

    /**
     * The process-wide cache. A {@link SimpleCache} must be unique per
     * directory for the life of the process, so it outlives service restarts.
     * Null when the cache cannot be opened; playback then streams as before.
     */
    @Nullable
    static synchronized Cache shared(Context context) {
        if (sharedCache != null || sharedCacheFailed) return sharedCache;
        Context appContext = context.getApplicationContext();
        try {
            sharedCache = new SimpleCache(
                new File(appContext.getCacheDir(), DIRECTORY),
                new LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES),
                new StandaloneDatabaseProvider(appContext)
            );
        } catch (RuntimeException error) {
            sharedCacheFailed = true;
            Log.w(TAG, "Stream cache unavailable; streaming without it", error);
        }
        return sharedCache;
    }

    /** The player's data sources: cached bytes first, the network for the rest. */
    static DataSource.Factory readThrough(@Nullable Cache cache, DataSource.Factory upstream) {
        if (cache == null) return upstream;
        return new CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(upstream)
            .setCacheWriteDataSinkFactory(null)
            .setCacheKeyFactory(NativeStreamCacheKeys.INSTANCE)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    static boolean isFullyCached(Cache cache, String key) {
        long length = ContentMetadata.getContentLength(cache.getContentMetadata(key));
        return length != C.LENGTH_UNSET && cache.isCached(key, 0L, length);
    }

    /**
     * Downloads the planned tracks one at a time on a background thread. A new
     * plan cancels the download in progress unless it is the same plan, so the
     * service can ask on every queue or cursor change. Failures (no network, a
     * variant still preparing) skip to the next track; the next plan retries.
     */
    static final class Prefetcher {
        private final Cache cache;
        private final CacheDataSource.Factory writeFactory;
        private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "crate-stream-prefetch");
            thread.setDaemon(true);
            thread.setPriority(Thread.MIN_PRIORITY);
            return thread;
        });
        private final AtomicLong generation = new AtomicLong();
        private final Object lock = new Object();
        @Nullable
        private CacheWriter activeWriter;
        private List<String> runningPlan = Collections.emptyList();
        private boolean running;

        Prefetcher(Cache cache, DataSource.Factory upstream) {
            this.cache = cache;
            StableStreamResponseDataSource.StoredLengths lengths =
                StableStreamResponseDataSource.storedLengthsOf(cache);
            this.writeFactory = new CacheDataSource.Factory()
                .setCache(cache)
                .setCacheKeyFactory(NativeStreamCacheKeys.INSTANCE)
                .setUpstreamDataSourceFactory(
                    () -> new StableStreamResponseDataSource(
                        upstream.createDataSource(),
                        NativeStreamCacheKeys.INSTANCE,
                        lengths
                    )
                );
        }

        void prefetch(List<String> urls) {
            List<String> plan = new ArrayList<>();
            for (String url : urls) {
                if (NativeStreamCacheKeys.isNetworkStream(url)) plan.add(url);
            }
            long planGeneration;
            synchronized (lock) {
                if (running && plan.equals(runningPlan)) return;
                planGeneration = generation.incrementAndGet();
                cancelActiveWriterLocked();
                if (plan.isEmpty()) {
                    runningPlan = Collections.emptyList();
                    running = false;
                    return;
                }
                runningPlan = plan;
                running = true;
            }
            try {
                executor.execute(() -> run(planGeneration, plan));
            } catch (RuntimeException rejected) {
                synchronized (lock) {
                    if (generation.get() == planGeneration) running = false;
                }
            }
        }

        void cancel() {
            synchronized (lock) {
                generation.incrementAndGet();
                cancelActiveWriterLocked();
                runningPlan = Collections.emptyList();
                running = false;
            }
        }

        void release() {
            cancel();
            executor.shutdownNow();
        }

        private void run(long planGeneration, List<String> plan) {
            try {
                for (String url : plan) {
                    if (generation.get() != planGeneration) return;
                    cacheTrack(planGeneration, url);
                }
            } finally {
                synchronized (lock) {
                    if (generation.get() == planGeneration) running = false;
                }
            }
        }

        private void cacheTrack(long planGeneration, String url) {
            DataSpec spec = new DataSpec(Uri.parse(url));
            String key = NativeStreamCacheKeys.INSTANCE.buildCacheKey(spec);
            if (isFullyCached(cache, key)) return;
            CacheWriter[] self = new CacheWriter[1];
            CacheWriter writer = new CacheWriter(
                writeFactory.createDataSource(),
                spec.buildUpon().setKey(key).build(),
                null,
                (requestLength, bytesCached, newBytesCached) -> {
                    if (requestLength > MAX_PREFETCH_BYTES && self[0] != null) {
                        self[0].cancel();
                    }
                }
            );
            self[0] = writer;
            synchronized (lock) {
                if (generation.get() != planGeneration) return;
                activeWriter = writer;
            }
            try {
                writer.cache();
            } catch (InterruptedIOException cancelled) {
                // A newer plan, the service stopping or a track over the size cap.
            } catch (IOException error) {
                Log.d(TAG, "Prefetch skipped: " + error.getMessage());
            } catch (RuntimeException error) {
                Log.w(TAG, "Prefetch failed", error);
            } finally {
                synchronized (lock) {
                    if (activeWriter == writer) activeWriter = null;
                }
            }
        }

        private void cancelActiveWriterLocked() {
            if (activeWriter != null) {
                activeWriter.cancel();
                activeWriter = null;
            }
        }
    }
}
