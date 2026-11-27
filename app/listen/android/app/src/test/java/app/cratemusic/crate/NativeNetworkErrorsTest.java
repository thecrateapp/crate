package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.common.PlaybackException;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.source.LoadEventInfo;
import androidx.media3.exoplayer.source.MediaLoadData;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class NativeNetworkErrorsTest {
    private static final DataSpec STREAM =
        new DataSpec(Uri.parse("https://api.example.test/api/tracks/1/stream"));

    private static HttpDataSource.HttpDataSourceException openFailure(IOException cause) {
        return new HttpDataSource.HttpDataSourceException(
            cause,
            STREAM,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            HttpDataSource.HttpDataSourceException.TYPE_OPEN
        );
    }

    private static HttpDataSource.InvalidResponseCodeException httpStatus(int status) {
        return new HttpDataSource.InvalidResponseCodeException(
            status,
            "status",
            null,
            Collections.emptyMap(),
            STREAM,
            new byte[0]
        );
    }

    private static LoadErrorHandlingPolicy.LoadErrorInfo loadError(
        IOException error,
        int errorCount
    ) {
        return new LoadErrorHandlingPolicy.LoadErrorInfo(
            new LoadEventInfo(0L, STREAM, 0L),
            new MediaLoadData(C.DATA_TYPE_MEDIA),
            error,
            errorCount
        );
    }

    @Test
    public void dnsAndSocketFailuresAreConnectivityFailures() {
        UnknownHostException dns = new UnknownHostException(
            "Unable to resolve host: android_getaddrinfo failed: EAI_NODATA"
        );

        assertTrue(NativeNetworkErrors.isConnectivityFailure(openFailure(dns)));
        assertTrue(NativeNetworkErrors.isConnectivityFailure(new ConnectException("refused")));
        assertTrue(NativeNetworkErrors.isConnectivityFailure(new SocketTimeoutException()));
    }

    @Test
    public void anHttpAnswerIsNotAConnectivityFailure() {
        assertFalse(NativeNetworkErrors.isConnectivityFailure(httpStatus(401)));
        assertFalse(NativeNetworkErrors.isConnectivityFailure(httpStatus(404)));
        assertFalse(NativeNetworkErrors.isConnectivityFailure(new IOException("corrupt")));
        assertFalse(NativeNetworkErrors.isConnectivityFailure(null));
    }

    @Test
    public void networkPlaybackErrorCodesAreConnectivityErrors() {
        assertTrue(
            NativeNetworkErrors.isConnectivityError(
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
                null
            )
        );
        assertTrue(
            NativeNetworkErrors.isConnectivityError(
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                null
            )
        );
        assertFalse(
            NativeNetworkErrors.isConnectivityError(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
                httpStatus(403)
            )
        );
        assertTrue(
            NativeNetworkErrors.isConnectivityError(
                PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
                new UnknownHostException("no address")
            )
        );
    }

    @Test
    public void connectivityLoadsKeepRetryingThroughAShortOutage() {
        ConnectivityTolerantLoadErrorPolicy policy = new ConnectivityTolerantLoadErrorPolicy();
        IOException dns = openFailure(new UnknownHostException("EAI_NODATA"));

        assertEquals(1000L, policy.getRetryDelayMsFor(loadError(dns, 1)));
        assertEquals(5000L, policy.getRetryDelayMsFor(loadError(dns, 9)));
        assertEquals(
            5000L,
            policy.getRetryDelayMsFor(
                loadError(dns, ConnectivityTolerantLoadErrorPolicy.CONNECTIVITY_RETRY_COUNT)
            )
        );
        assertEquals(
            C.TIME_UNSET,
            policy.getRetryDelayMsFor(
                loadError(dns, ConnectivityTolerantLoadErrorPolicy.CONNECTIVITY_RETRY_COUNT + 1)
            )
        );
        assertTrue(
            policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA) >=
                ConnectivityTolerantLoadErrorPolicy.CONNECTIVITY_RETRY_COUNT
        );
    }

    @Test
    public void otherLoadErrorsStillFailAfterTheDefaultRetries() {
        ConnectivityTolerantLoadErrorPolicy policy = new ConnectivityTolerantLoadErrorPolicy();
        IOException unavailable = httpStatus(503);

        assertEquals(
            C.TIME_UNSET,
            policy.getRetryDelayMsFor(
                loadError(
                    unavailable,
                    ConnectivityTolerantLoadErrorPolicy.DEFAULT_RETRY_COUNT + 1
                )
            )
        );
    }
}
