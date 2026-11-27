package app.cratemusic.crate;

import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.cache.CacheKeyFactory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Cache keys for streamed tracks: the stream URL without the credentials that
 * rotate between requests (media tickets, tokens), so a track keeps one key
 * across sessions. The path names the track and {@code delivery} the quality,
 * so an original and a transcoded copy never share bytes.
 */
@OptIn(markerClass = UnstableApi.class)
final class NativeStreamCacheKeys implements CacheKeyFactory {
    static final NativeStreamCacheKeys INSTANCE = new NativeStreamCacheKeys();

    private static final String PREFIX = "crate-stream:v1:";
    private static final Set<String> VOLATILE_PARAMETERS = new HashSet<>(
        Arrays.asList("token", "media_ticket", "access_token", "exp", "expires", "signature", "sig")
    );

    private NativeStreamCacheKeys() {}

    @Override
    public String buildCacheKey(DataSpec dataSpec) {
        if (dataSpec.key != null) return dataSpec.key;
        return keyFor(dataSpec.uri);
    }

    static String keyFor(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) return uri.toString();
        StringBuilder key = new StringBuilder(PREFIX)
            .append(scheme)
            .append("://")
            .append(uri.getEncodedAuthority() == null ? "" : uri.getEncodedAuthority())
            .append(uri.getEncodedPath() == null ? "" : uri.getEncodedPath());
        List<String> names = new ArrayList<>(uri.getQueryParameterNames());
        Collections.sort(names);
        char separator = '?';
        for (String name : names) {
            if (VOLATILE_PARAMETERS.contains(name.toLowerCase(Locale.ROOT))) continue;
            for (String value : uri.getQueryParameters(name)) {
                key.append(separator).append(Uri.encode(name)).append('=').append(Uri.encode(value));
                separator = '&';
            }
        }
        return key.toString();
    }

    static boolean isNetworkStream(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.ROOT);
        return lower.startsWith("https://") || lower.startsWith("http://");
    }
}
