package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class DeviceProfileStoreTest {
    static final long EXPIRES_AT_MS = 2_000_000_000_000L;

    // Stands in for the Keystore cipher, which Robolectric does not provide.
    static final class FakeCodec implements DeviceProfileStore.Codec {
        boolean failDecrypt = false;

        @Override
        public String encrypt(String value) {
            return "enc:" + Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public String decrypt(String value) throws Exception {
            if (failDecrypt || !value.startsWith("enc:")) throw new IllegalStateException("bad key");
            return new String(Base64.getDecoder().decode(value.substring(4)), StandardCharsets.UTF_8);
        }
    }

    static DeviceProfileStore.Profile profile(String serverUrl, String token) {
        return DeviceProfileStore.Profile.create(
            serverUrl,
            "server-1",
            token,
            42L,
            EXPIRES_AT_MS,
            "balanced",
            "profile-key",
            "device-0123456789",
            false
        );
    }

    static SharedPreferences preferences() {
        return RuntimeEnvironment.getApplication()
            .getSharedPreferences(DeviceProfileStore.STORE_NAME, Context.MODE_PRIVATE);
    }

    private final FakeCodec codec = new FakeCodec();

    @Before
    public void clearPreferences() {
        preferences().edit().clear().commit();
    }

    @Test
    public void acceptsHttpsServersAndLoopbackHttpOnlyInDebug() {
        assertNotNull(profile("https://api.example/", "crv_device"));
        assertEquals("https://api.example", profile("https://api.example/", "crv_device").serverUrl);
        assertNull(profile("http://api.example", "crv_device"));
        assertNull(profile("http://localhost:8585", "crv_device"));
        assertNotNull(
            DeviceProfileStore.Profile.create(
                "http://localhost:8585", "s", "crv_x", 1L, 1L, "auto", null, null, true
            )
        );
        assertNull(
            DeviceProfileStore.Profile.create(
                "http://192.168.1.2:8585", "s", "crv_x", 1L, 1L, "auto", null, null, true
            )
        );
        assertNull(profile("https://user:pass@api.example", "crv_device"));
        assertNull(profile("https://api.example/?next=x", "crv_device"));
        assertNull(profile("ftp://api.example", "crv_device"));
    }

    @Test
    public void acceptsOnlyDeviceTokensAndCompleteRecords() {
        assertNull(profile("https://api.example", "eyJhbGciOi.session.jwt"));
        assertNull(profile("https://api.example", "crv_"));
        assertNull(profile("https://api.example", "crv_with space"));
        assertNull(profile("https://api.example", null));
        assertNull(
            DeviceProfileStore.Profile.create(
                "https://api.example", "", "crv_x", 1L, 1L, "auto", null, null, false
            )
        );
        assertNull(
            DeviceProfileStore.Profile.create(
                "https://api.example", "s", "crv_x", 0L, 1L, "auto", null, null, false
            )
        );
        assertNull(
            DeviceProfileStore.Profile.create(
                "https://api.example", "s", "crv_x", 1L, 0L, "auto", null, null, false
            )
        );
        assertNull(
            DeviceProfileStore.Profile.create(
                "https://api.example", "s", "crv_x", 1L, 1L, "auto", null, "bad id!", false
            )
        );
    }

    @Test
    public void normalisesTheDeliveryPolicy() {
        for (String policy : new String[] {"auto", "original", "balanced", "data_saver"}) {
            assertEquals(policy, DeviceProfileStore.normalizedDelivery(policy));
        }
        assertEquals("auto", DeviceProfileStore.normalizedDelivery("lossless"));
        assertEquals("auto", DeviceProfileStore.normalizedDelivery(null));
    }

    @Test
    public void roundTripsThroughJson() throws Exception {
        DeviceProfileStore.Profile original = profile("https://api.example", "crv_device");
        DeviceProfileStore.Profile restored = DeviceProfileStore.fromJson(
            DeviceProfileStore.toJson(original),
            false
        );

        assertNotNull(restored);
        assertEquals("https://api.example", restored.serverUrl);
        assertEquals("server-1", restored.serverId);
        assertEquals("crv_device", restored.deviceToken);
        assertEquals(42L, restored.tokenId);
        assertEquals(EXPIRES_AT_MS, restored.expiresAtMs);
        assertEquals("balanced", restored.deliveryPolicy);
        assertEquals("profile-key", restored.offlineProfileKey);
        assertEquals("device-0123456789", restored.deviceId);
        assertNull(DeviceProfileStore.fromJson("{\"v\":2}", false));
        assertNull(DeviceProfileStore.fromJson("not json", false));
        assertNull(DeviceProfileStore.fromJson(null, false));
    }

    @Test
    public void neverPrintsTheToken() {
        assertFalse(profile("https://api.example", "crv_secret").toString().contains("crv_secret"));
    }

    @Test
    public void persistsTheProfileEncrypted() throws Exception {
        DeviceProfileStore store = new DeviceProfileStore(preferences(), codec, false);
        store.save(profile("https://api.example", "crv_device"));

        String stored = preferences().getString(DeviceProfileStore.PROFILE_KEY, "");
        assertTrue(stored.startsWith("enc:"));
        assertFalse(stored.contains("crv_device"));
        DeviceProfileStore reopened = new DeviceProfileStore(preferences(), codec, false);
        assertNotNull(reopened.current());
        assertEquals("crv_device", reopened.current().deviceToken);
    }

    @Test
    public void dropsAnUnreadableRecord() throws Exception {
        new DeviceProfileStore(preferences(), codec, false)
            .save(profile("https://api.example", "crv_device"));
        codec.failDecrypt = true;

        DeviceProfileStore reopened = new DeviceProfileStore(preferences(), codec, false);

        assertNull(reopened.current());
        assertFalse(preferences().contains(DeviceProfileStore.PROFILE_KEY));
    }

    @Test
    public void givesTheTokenOnlyToItsOriginBeforeExpiry() throws Exception {
        DeviceProfileStore store = new DeviceProfileStore(preferences(), codec, false);
        assertNull(store.tokenFor("https://api.example/api/tracks/1/stream", 0L));
        store.save(profile("https://api.example", "crv_device"));

        assertEquals("crv_device", store.tokenFor("https://api.example/api/tracks/1/stream", 0L));
        assertNull(store.tokenFor("https://other.example/api/tracks/1/stream", 0L));
        assertNull(store.tokenFor("http://api.example/api/tracks/1/stream", 0L));
        assertNull(store.tokenFor("https://api.example/api/tracks/1/stream", EXPIRES_AT_MS));
    }

    @Test
    public void updatesPreferencesWithoutTheToken() throws Exception {
        DeviceProfileStore store = new DeviceProfileStore(preferences(), codec, false);
        assertNull(store.updatePreferences("original", true, null));
        store.save(profile("https://api.example", "crv_device"));

        DeviceProfileStore.Profile delivery = store.updatePreferences("data_saver", false, null);
        assertEquals("data_saver", delivery.deliveryPolicy);
        assertEquals("profile-key", delivery.offlineProfileKey);
        DeviceProfileStore.Profile offline = store.updatePreferences(null, true, "other-key");
        assertEquals("data_saver", offline.deliveryPolicy);
        assertEquals("other-key", offline.offlineProfileKey);
        assertEquals("crv_device", offline.deviceToken);
        DeviceProfileStore.Profile noOffline = store.updatePreferences(null, true, null);
        assertNull(noOffline.offlineProfileKey);
        DeviceProfileStore reopened = new DeviceProfileStore(preferences(), codec, false);
        assertEquals("data_saver", reopened.current().deliveryPolicy);
    }

    @Test
    public void clearsAndTellsListenersWhy() throws Exception {
        DeviceProfileStore store = new DeviceProfileStore(preferences(), codec, false);
        List<String> events = new ArrayList<>();
        store.addListener(
            (@Nullable DeviceProfileStore.Profile profile, @Nullable DeviceProfileStore.ClearReason reason) ->
                events.add(profile == null ? "cleared:" + reason : "saved:" + profile.tokenId)
        );

        store.save(profile("https://api.example", "crv_device"));
        assertFalse(store.clearIfToken("crv_older", DeviceProfileStore.ClearReason.UNAUTHORIZED));
        assertNotNull(store.current());
        assertTrue(store.clearIfToken("crv_device", DeviceProfileStore.ClearReason.UNAUTHORIZED));
        assertNull(store.current());
        store.clear(DeviceProfileStore.ClearReason.CLEARED);

        assertEquals(2, events.size());
        assertEquals("saved:42", events.get(0));
        assertEquals("cleared:UNAUTHORIZED", events.get(1));
        assertNull(new DeviceProfileStore(preferences(), codec, false).current());
    }
}
