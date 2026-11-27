package app.cratemusic.crate;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.HttpDataSource;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.PortUnreachableException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

/**
 * Tells a lost network (no DNS answer, no route, a dropped or timed-out socket)
 * from a server that answered. A phone handing over from Wi-Fi to mobile data,
 * entering a tunnel or waking from Doze cannot resolve the stream host for a
 * few seconds ("android_getaddrinfo failed: EAI_NODATA"); that is worth waiting
 * out, while an HTTP status is the server's final word.
 */
@OptIn(markerClass = UnstableApi.class)
final class NativeNetworkErrors {
    private static final int MAX_CAUSE_DEPTH = 16;

    private NativeNetworkErrors() {}

    static boolean isConnectivityFailure(@Nullable Throwable error) {
        Throwable current = error;
        for (int depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
            if (current instanceof HttpDataSource.InvalidResponseCodeException) {
                return false;
            }
            if (
                current instanceof UnknownHostException ||
                current instanceof ConnectException ||
                current instanceof NoRouteToHostException ||
                current instanceof PortUnreachableException ||
                current instanceof SocketTimeoutException ||
                current instanceof SocketException
            ) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    static boolean isConnectivityError(int errorCode, @Nullable Throwable cause) {
        if (
            errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
        ) {
            return !(cause instanceof HttpDataSource.InvalidResponseCodeException);
        }
        if (errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) return false;
        return isConnectivityFailure(cause);
    }

    static boolean isConnectivityError(PlaybackException error) {
        return isConnectivityError(error.errorCode, error.getCause());
    }
}
