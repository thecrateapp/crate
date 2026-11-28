package app.cratemusic.crate;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.Nullable;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The one active native device profile (Android Auto phase AA2): the server
// the phone is signed in to, its native device token and the listener's
// delivery and offline choices. JS writes it through CrateDevicePlugin; the
// playback service reads it without the WebView. The record is encrypted
// with its own Android Keystore key (AES-GCM), like CrateSecureSessionPlugin.
final class DeviceProfileStore {
    private static final String TAG = "CrateDeviceProfile";
    static final String STORE_NAME = "crate_device_profile";
    static final String PROFILE_KEY = "profile";
    private static final String KEY_ALIAS = "crate.device.keystore.v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TOKEN_PREFIX = "crv_";
    private static final int MAX_FIELD_LENGTH = 2_048;
    private static final Pattern DEVICE_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{8,128}$");
    static final Set<String> DELIVERY_POLICIES = new HashSet<>(
        Arrays.asList("auto", "original", "balanced", "data_saver")
    );

    enum ClearReason {
        CLEARED,
        UNAUTHORIZED
    }

    interface Listener {
        // profile is null when it was cleared; reason says why.
        void onProfileChanged(@Nullable Profile profile, @Nullable ClearReason reason);
    }

    interface Codec {
        String encrypt(String value) throws Exception;

        String decrypt(String value) throws Exception;
    }

    static final class Profile {
        final String serverUrl;
        final String serverId;
        final String deviceToken;
        final long tokenId;
        final long expiresAtMs;
        final String deliveryPolicy;
        @Nullable
        final String offlineProfileKey;
        @Nullable
        final String deviceId;

        private Profile(
            String serverUrl,
            String serverId,
            String deviceToken,
            long tokenId,
            long expiresAtMs,
            String deliveryPolicy,
            @Nullable String offlineProfileKey,
            @Nullable String deviceId
        ) {
            this.serverUrl = serverUrl;
            this.serverId = serverId;
            this.deviceToken = deviceToken;
            this.tokenId = tokenId;
            this.expiresAtMs = expiresAtMs;
            this.deliveryPolicy = deliveryPolicy;
            this.offlineProfileKey = offlineProfileKey;
            this.deviceId = deviceId;
        }

        // Validates and normalises a profile; null when any field is unusable.
        @Nullable
        static Profile create(
            @Nullable String serverUrl,
            @Nullable String serverId,
            @Nullable String deviceToken,
            long tokenId,
            long expiresAtMs,
            @Nullable String deliveryPolicy,
            @Nullable String offlineProfileKey,
            @Nullable String deviceId,
            boolean allowLoopbackHttp
        ) {
            String url = trimTrailingSlash(serverUrl);
            String origin = NativeTrustedOrigin.of(url, allowLoopbackHttp);
            if (origin.isEmpty() || url.length() > MAX_FIELD_LENGTH) return null;
            // API paths are appended to the server URL, so it carries no query.
            if (url.contains("?") || url.contains("#")) return null;
            if (!isBounded(serverId)) return null;
            if (
                deviceToken == null ||
                !deviceToken.startsWith(TOKEN_PREFIX) ||
                deviceToken.length() <= TOKEN_PREFIX.length() ||
                deviceToken.length() > MAX_FIELD_LENGTH ||
                containsWhitespace(deviceToken)
            ) {
                return null;
            }
            if (tokenId <= 0 || expiresAtMs <= 0) return null;
            String delivery = normalizedDelivery(deliveryPolicy);
            String offlineKey = offlineProfileKey == null || offlineProfileKey.isEmpty()
                ? null
                : offlineProfileKey;
            if (offlineKey != null && offlineKey.length() > MAX_FIELD_LENGTH) return null;
            String device = deviceId == null || deviceId.isEmpty() ? null : deviceId;
            if (device != null && !DEVICE_ID_PATTERN.matcher(device).matches()) return null;
            return new Profile(
                url,
                serverId,
                deviceToken,
                tokenId,
                expiresAtMs,
                delivery,
                offlineKey,
                device
            );
        }

        Profile withPreferences(
            @Nullable String deliveryPolicy,
            boolean replaceOfflineProfileKey,
            @Nullable String offlineProfileKey
        ) {
            String offlineKey = replaceOfflineProfileKey
                ? (offlineProfileKey == null || offlineProfileKey.isEmpty() ? null : offlineProfileKey)
                : this.offlineProfileKey;
            if (offlineKey != null && offlineKey.length() > MAX_FIELD_LENGTH) {
                offlineKey = this.offlineProfileKey;
            }
            return new Profile(
                serverUrl,
                serverId,
                deviceToken,
                tokenId,
                expiresAtMs,
                deliveryPolicy == null ? this.deliveryPolicy : normalizedDelivery(deliveryPolicy),
                offlineKey,
                deviceId
            );
        }

        String origin(boolean allowLoopbackHttp) {
            return NativeTrustedOrigin.of(serverUrl, allowLoopbackHttp);
        }

        boolean isExpired(long nowWallMs) {
            return nowWallMs >= expiresAtMs;
        }

        // The device token for a request to url, or null when the profile
        // belongs to another origin or has expired.
        @Nullable
        String tokenFor(@Nullable String url, long nowWallMs, boolean allowLoopbackHttp) {
            if (isExpired(nowWallMs)) return null;
            String origin = NativeTrustedOrigin.of(url, allowLoopbackHttp);
            if (origin.isEmpty() || !origin.equals(origin(allowLoopbackHttp))) return null;
            return deviceToken;
        }

        @Override
        public String toString() {
            // Never print the token.
            return "Profile{serverId=" + serverId + ", tokenId=" + tokenId + "}";
        }
    }

    static String toJson(Profile profile) throws JSONException {
        JSONObject json = new JSONObject()
            .put("v", 1)
            .put("serverUrl", profile.serverUrl)
            .put("serverId", profile.serverId)
            .put("deviceToken", profile.deviceToken)
            .put("tokenId", profile.tokenId)
            .put("expiresAtMs", profile.expiresAtMs)
            .put("deliveryPolicy", profile.deliveryPolicy);
        if (profile.offlineProfileKey != null) {
            json.put("offlineProfileKey", profile.offlineProfileKey);
        }
        if (profile.deviceId != null) json.put("deviceId", profile.deviceId);
        return json.toString();
    }

    @Nullable
    static Profile fromJson(@Nullable String raw, boolean allowLoopbackHttp) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(raw);
            if (json.optInt("v", 0) != 1) return null;
            return Profile.create(
                json.optString("serverUrl", ""),
                json.optString("serverId", ""),
                json.optString("deviceToken", ""),
                json.optLong("tokenId", 0L),
                json.optLong("expiresAtMs", 0L),
                json.optString("deliveryPolicy", "auto"),
                json.has("offlineProfileKey") ? json.optString("offlineProfileKey") : null,
                json.has("deviceId") ? json.optString("deviceId") : null,
                allowLoopbackHttp
            );
        } catch (JSONException error) {
            return null;
        }
    }

    static String normalizedDelivery(@Nullable String deliveryPolicy) {
        return deliveryPolicy != null && DELIVERY_POLICIES.contains(deliveryPolicy)
            ? deliveryPolicy
            : "auto";
    }

    private static boolean isBounded(@Nullable String value) {
        return value != null && !value.isEmpty() && value.length() <= MAX_FIELD_LENGTH;
    }

    private static boolean containsWhitespace(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isWhitespace(value.charAt(index))) return true;
        }
        return false;
    }

    private static String trimTrailingSlash(@Nullable String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    @Nullable
    private static volatile DeviceProfileStore shared;

    // The process-wide store, usable from the service without the WebView.
    static DeviceProfileStore get(Context context) {
        DeviceProfileStore store = shared;
        if (store != null) return store;
        synchronized (DeviceProfileStore.class) {
            if (shared == null) {
                shared = new DeviceProfileStore(
                    context.getApplicationContext().getSharedPreferences(
                        STORE_NAME,
                        Context.MODE_PRIVATE
                    ),
                    new KeystoreCodec(),
                    BuildConfig.DEBUG
                );
            }
            return shared;
        }
    }

    private final SharedPreferences preferences;
    private final Codec codec;
    private final boolean allowLoopbackHttp;
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private volatile boolean loaded = false;
    @Nullable
    private volatile Profile cached;

    DeviceProfileStore(SharedPreferences preferences, Codec codec, boolean allowLoopbackHttp) {
        this.preferences = preferences;
        this.codec = codec;
        this.allowLoopbackHttp = allowLoopbackHttp;
    }

    boolean allowsLoopbackHttp() {
        return allowLoopbackHttp;
    }

    @Nullable
    Profile current() {
        if (loaded) return cached;
        synchronized (this) {
            if (!loaded) {
                cached = readStored();
                loaded = true;
            }
            return cached;
        }
    }

    // The device token for a request to url, or null.
    @Nullable
    String tokenFor(@Nullable String url, long nowWallMs) {
        Profile profile = current();
        return profile == null ? null : profile.tokenFor(url, nowWallMs, allowLoopbackHttp);
    }

    synchronized void save(Profile profile) throws Exception {
        String encrypted = codec.encrypt(toJson(profile));
        if (!preferences.edit().putString(PROFILE_KEY, encrypted).commit()) {
            throw new IllegalStateException("Device profile commit failed");
        }
        cached = profile;
        loaded = true;
        notifyListeners(profile, null);
    }

    // Replaces the delivery policy and, when asked, the offline profile key.
    // Returns the updated profile, or null when there is none.
    @Nullable
    synchronized Profile updatePreferences(
        @Nullable String deliveryPolicy,
        boolean replaceOfflineProfileKey,
        @Nullable String offlineProfileKey
    ) throws Exception {
        Profile profile = current();
        if (profile == null) return null;
        Profile updated = profile.withPreferences(
            deliveryPolicy,
            replaceOfflineProfileKey,
            offlineProfileKey
        );
        save(updated);
        return updated;
    }

    synchronized boolean clear(ClearReason reason) {
        boolean committed = preferences.edit().remove(PROFILE_KEY).commit();
        boolean hadProfile = current() != null;
        cached = null;
        loaded = true;
        if (hadProfile) notifyListeners(null, reason);
        return committed;
    }

    // Clears the profile only while it still holds deviceToken, so a 401 for
    // an old token never drops a profile JS minted since.
    synchronized boolean clearIfToken(String deviceToken, ClearReason reason) {
        Profile profile = current();
        if (profile == null || !profile.deviceToken.equals(deviceToken)) return false;
        return clear(reason);
    }

    void addListener(Listener listener) {
        listeners.addIfAbsent(listener);
    }

    void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    private void notifyListeners(@Nullable Profile profile, @Nullable ClearReason reason) {
        for (Listener listener : listeners) {
            try {
                listener.onProfileChanged(profile, reason);
            } catch (RuntimeException error) {
                Log.w(TAG, "Device profile listener failed", error);
            }
        }
    }

    @Nullable
    private Profile readStored() {
        String encrypted = preferences.getString(PROFILE_KEY, null);
        if (encrypted == null) return null;
        try {
            Profile profile = fromJson(codec.decrypt(encrypted), allowLoopbackHttp);
            if (profile == null) preferences.edit().remove(PROFILE_KEY).apply();
            return profile;
        } catch (Exception error) {
            // A key reset (backup restore, keystore wipe) leaves an
            // undecryptable record; drop it and let JS mint again.
            Log.w(TAG, "Dropping an unreadable device profile");
            preferences.edit().remove(PROFILE_KEY).apply();
            return null;
        }
    }

    static final class KeystoreCodec implements Codec {
        private synchronized SecretKey secretKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
            if (existing instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
            }
            KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                KEYSTORE
            );
            generator.init(
                new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            );
            return generator.generateKey();
        }

        @Override
        public String encrypt(String value) throws Exception {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            ByteBuffer payload = ByteBuffer.allocate(4 + iv.length + ciphertext.length);
            payload.putInt(iv.length);
            payload.put(iv);
            payload.put(ciphertext);
            return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
        }

        @Override
        public String decrypt(String encoded) throws Exception {
            byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
            ByteBuffer buffer = ByteBuffer.wrap(payload);
            int ivLength = buffer.getInt();
            if (ivLength < 12 || ivLength > 16 || buffer.remaining() <= ivLength) {
                throw new IllegalArgumentException("Invalid encrypted payload");
            }
            byte[] iv = new byte[ivLength];
            buffer.get(iv);
            byte[] ciphertext = new byte[buffer.remaining()];
            buffer.get(ciphertext);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        }
    }
}
