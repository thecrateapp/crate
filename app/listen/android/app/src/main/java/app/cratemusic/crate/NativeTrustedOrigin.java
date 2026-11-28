package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.net.URI;

// The origin rule for every credential the native player sends: https, or
// http to a loopback host in debug builds. A URL with user info has no origin.
final class NativeTrustedOrigin {
    private NativeTrustedOrigin() {}

    static String of(@Nullable String url, boolean allowLoopbackHttp) {
        try {
            URI uri = URI.create(url == null ? "" : url);
            if (uri.getHost() == null || uri.getRawUserInfo() != null) {
                return "";
            }
            String scheme = uri.getScheme();
            if ("https".equalsIgnoreCase(scheme)) {
                return "https://" + uri.getRawAuthority();
            }
            if (
                allowLoopbackHttp &&
                "http".equalsIgnoreCase(scheme) &&
                isLoopbackHost(uri.getHost())
            ) {
                return "http://" + uri.getRawAuthority();
            }
            return "";
        } catch (RuntimeException error) {
            return "";
        }
    }

    // The path of a URL, or "" when it cannot be parsed.
    static String path(@Nullable String url) {
        try {
            String path = URI.create(url == null ? "" : url).getRawPath();
            return path == null ? "" : path;
        } catch (RuntimeException error) {
            return "";
        }
    }

    private static boolean isLoopbackHost(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
    }
}
