package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

import org.json.JSONException;
import org.json.JSONObject;

final class NativeStreamAuthorization {
    static final long SESSION_EXPIRY_MARGIN_MS = 60_000L;
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String BASE64URL =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    // Path segments the server accepts as an entity uid or a variant id.
    private static final String SEGMENT = "(?!\\.\\.?(?:/|$))[^/]+";
    // The stream and artwork routes of the native device token's allowlist
    // (_NATIVE_DEVICE_ACCESS_TOKEN_ROUTES in app/crate/api/auth.py). Other
    // URLs on the same origin (federated streams) keep the session bearer.
    private static final Pattern DEVICE_STREAM_PATH = Pattern.compile(
        "^/api/(?:tracks/by-entity/" + SEGMENT + "/stream" +
            "|catalog/tracks/" + SEGMENT + "/stream" +
            "|tracks/\\d+/stream" +
            "|stream/.+" +
            "|playback/variants/" + SEGMENT + "/stream)$"
    );
    private static final Pattern DEVICE_ARTWORK_PATH = Pattern.compile(
        "^/api/(?:albums/\\d+/cover" +
            "|albums/by-entity/" + SEGMENT + "/cover" +
            "|catalog/albums/" + SEGMENT + "/cover" +
            "|artists/\\d+/(?:photo|background)" +
            "|artists/by-entity/" + SEGMENT + "/(?:photo|background)" +
            "|catalog/artists/" + SEGMENT + "/(?:photo|background))$"
    );

    private NativeStreamAuthorization() {}

    static boolean deviceTokenCoversStream(@Nullable String path) {
        return path != null && DEVICE_STREAM_PATH.matcher(path).matches();
    }

    static boolean deviceTokenCoversArtwork(@Nullable String path) {
        return path != null && DEVICE_ARTWORK_PATH.matcher(path).matches();
    }

    // D7: a stream the device token covers always uses it, for native and
    // JS-loaded queues alike. Without a device profile (older servers, or a
    // profile for another origin) the session bearer and its continuation
    // fallback stay as they were.
    @Nullable
    static String chooseStream(
        @Nullable String path,
        @Nullable String deviceToken,
        @Nullable String sessionAuthorization,
        @Nullable String continuationToken,
        long nowWallMs
    ) {
        if (deviceToken != null && !deviceToken.isEmpty() && deviceTokenCoversStream(path)) {
            return BEARER_PREFIX + deviceToken;
        }
        return choose(sessionAuthorization, continuationToken, nowWallMs);
    }

    // The device token a 401/403 response refused, or null when the request
    // was not authorized with a device-format bearer. The store clears the
    // profile only if that token is still the active one, so a refused
    // session bearer or continuation token never clears it.
    @Nullable
    static String rejectedDeviceToken(@Nullable Integer httpStatus, @Nullable String authorization) {
        if (httpStatus == null || (httpStatus != 401 && httpStatus != 403)) return null;
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX + "crv_")) return null;
        return authorization.substring(BEARER_PREFIX.length());
    }

    @Nullable
    static String chooseArtwork(
        @Nullable String path,
        @Nullable String deviceToken,
        @Nullable String sessionAuthorization
    ) {
        if (deviceToken != null && !deviceToken.isEmpty() && deviceTokenCoversArtwork(path)) {
            return BEARER_PREFIX + deviceToken;
        }
        return sessionAuthorization;
    }

    @Nullable
    static String choose(
        @Nullable String sessionAuthorization,
        @Nullable String continuationToken,
        long nowWallMs
    ) {
        if (continuationToken == null || continuationToken.isEmpty()) {
            return sessionAuthorization;
        }
        if (
            sessionAuthorization != null &&
            !sessionAuthorization.isEmpty() &&
            bearerExpiryMs(sessionAuthorization) - SESSION_EXPIRY_MARGIN_MS > nowWallMs
        ) {
            return sessionAuthorization;
        }
        return BEARER_PREFIX + continuationToken;
    }

    static long bearerExpiryMs(String authorization) {
        if (!authorization.startsWith(BEARER_PREFIX)) return 0L;
        String[] parts = authorization.substring(BEARER_PREFIX.length()).split("\\.");
        if (parts.length != 3) return 0L;
        byte[] payload = decodeBase64Url(parts[1]);
        if (payload == null) return 0L;
        try {
            return new JSONObject(new String(payload, StandardCharsets.UTF_8))
                .optLong("exp", 0L) * 1000L;
        } catch (JSONException error) {
            return 0L;
        }
    }

    @Nullable
    private static byte[] decodeBase64Url(String value) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int buffer = 0;
        int bits = 0;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '=') break;
            int digit = BASE64URL.indexOf(character);
            if (digit < 0) return null;
            buffer = (buffer << 6) | digit;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                output.write((buffer >> bits) & 0xFF);
            }
        }
        return output.toByteArray();
    }
}
