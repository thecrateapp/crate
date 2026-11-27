package app.cratemusic.crate;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;

/**
 * Keeps a stream loading through a short network outage instead of failing.
 *
 * <p>Media3's default gives up after a few retries spread over seconds, so a
 * Wi-Fi to mobile handover or a tunnel stopped playback for good: with the
 * screen off the WebView is frozen and nothing retried. Connectivity failures
 * (see {@link NativeNetworkErrors}) now retry with a growing delay, capped at 5
 * s, for about three minutes while the player shows buffering. Every other load
 * error keeps the default retries and then fails, so HTTP statuses (an expired
 * authorization, a missing file) still surface quickly.
 */
@OptIn(markerClass = UnstableApi.class)
final class ConnectivityTolerantLoadErrorPolicy extends DefaultLoadErrorHandlingPolicy {
    /** 1 + 2 + 3 + 4 s, then 5 s per retry: about 190 s of outage. */
    static final int CONNECTIVITY_RETRY_COUNT = 40;
    static final int DEFAULT_RETRY_COUNT = DEFAULT_MIN_LOADABLE_RETRY_COUNT;
    private static final long RETRY_STEP_MS = 1_000L;
    private static final long MAX_RETRY_DELAY_MS = 5_000L;

    @Override
    public long getRetryDelayMsFor(LoadErrorInfo loadErrorInfo) {
        if (NativeNetworkErrors.isConnectivityFailure(loadErrorInfo.exception)) {
            if (loadErrorInfo.errorCount > CONNECTIVITY_RETRY_COUNT) return C.TIME_UNSET;
            return Math.min(loadErrorInfo.errorCount * RETRY_STEP_MS, MAX_RETRY_DELAY_MS);
        }
        // The raised minimum below would otherwise let these retry as long.
        if (loadErrorInfo.errorCount > DEFAULT_RETRY_COUNT) return C.TIME_UNSET;
        return super.getRetryDelayMsFor(loadErrorInfo);
    }

    @Override
    public int getMinimumLoadableRetryCount(int dataType) {
        return Math.max(CONNECTIVITY_RETRY_COUNT, super.getMinimumLoadableRetryCount(dataType));
    }
}
