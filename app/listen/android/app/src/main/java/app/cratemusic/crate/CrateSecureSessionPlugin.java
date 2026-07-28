package app.cratemusic.crate;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "CrateSecureSession")
public class CrateSecureSessionPlugin extends Plugin {
    private static final String STORE_NAME = "crate_secure_session";
    private static final String KEY_ALIAS = "crate.session.keystore.v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final Pattern KEY_PATTERN =
        Pattern.compile("^crate\\.(session|oauth)\\.[A-Za-z0-9._~-]+$");
    private static final Pattern PREFIX_PATTERN =
        Pattern.compile("^crate\\.(session|oauth)\\.$");

    static boolean isValidKey(String key) {
        return key != null && KEY_PATTERN.matcher(key).matches();
    }

    static boolean isValidPrefix(String prefix) {
        return prefix != null && PREFIX_PATTERN.matcher(prefix).matches();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (!isValidKey(key)) {
            call.reject("Invalid secure session key");
            return;
        }
        try {
            String encrypted = preferences().getString(key, null);
            JSObject result = new JSObject();
            result.put("value", encrypted == null ? null : decrypt(encrypted));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure session storage is unavailable");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!isValidKey(key) || !isValidJsonValue(value)) {
            call.reject("Invalid secure session entry");
            return;
        }
        try {
            if (!preferences().edit().putString(key, encrypt(value)).commit()) {
                throw new IllegalStateException("Secure preference commit failed");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure session storage is unavailable");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!isValidKey(key)) {
            call.reject("Invalid secure session key");
            return;
        }
        if (preferences().edit().remove(key).commit()) {
            call.resolve();
        } else {
            call.reject("Secure session storage is unavailable");
        }
    }

    @PluginMethod
    public void listKeys(PluginCall call) {
        String prefix = call.getString("prefix");
        if (!isValidPrefix(prefix)) {
            call.reject("Invalid secure session prefix");
            return;
        }
        List<String> keys = new ArrayList<>();
        for (String key : preferences().getAll().keySet()) {
            if (key.startsWith(prefix) && isValidKey(key)) {
                keys.add(key);
            }
        }
        JSObject result = new JSObject();
        result.put("keys", new JSArray(keys));
        call.resolve(result);
    }

    @PluginMethod
    public void clearPrefix(PluginCall call) {
        String prefix = call.getString("prefix");
        if (!isValidPrefix(prefix)) {
            call.reject("Invalid secure session prefix");
            return;
        }
        SharedPreferences.Editor editor = preferences().edit();
        int removed = 0;
        for (Map.Entry<String, ?> entry : preferences().getAll().entrySet()) {
            if (entry.getKey().startsWith(prefix) && isValidKey(entry.getKey())) {
                editor.remove(entry.getKey());
                removed += 1;
            }
        }
        if (!editor.commit()) {
            call.reject("Secure session storage is unavailable");
            return;
        }
        JSObject result = new JSObject();
        result.put("removed", removed);
        call.resolve(result);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE);
    }

    private boolean isValidJsonValue(String value) {
        if (value == null || value.isEmpty() || value.length() > 65_536) {
            return false;
        }
        try {
            new JSONObject(value);
            return true;
        } catch (JSONException error) {
            return false;
        }
    }

    private SecretKey secretKey() throws Exception {
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

    private String encrypt(String value) throws Exception {
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

    private String decrypt(String encoded) throws Exception {
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
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            new GCMParameterSpec(128, iv)
        );
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }
}
