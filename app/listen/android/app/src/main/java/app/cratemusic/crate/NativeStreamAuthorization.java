package app.cratemusic.crate;

import androidx.annotation.Nullable;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.json.JSONException;
import org.json.JSONObject;

final class NativeStreamAuthorization {
    static final long SESSION_EXPIRY_MARGIN_MS = 60_000L;
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String BASE64URL =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    private NativeStreamAuthorization() {}

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
