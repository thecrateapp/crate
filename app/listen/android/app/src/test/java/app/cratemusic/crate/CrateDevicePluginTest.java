package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class CrateDevicePluginTest {
    @Test
    public void readsWholeNumbersFromTheBridge() {
        assertEquals(42L, CrateDevicePlugin.wholeNumber(42));
        assertEquals(1_792_316_460_000L, CrateDevicePlugin.wholeNumber(1_792_316_460_000L));
        assertEquals(1_792_316_460_000L, CrateDevicePlugin.wholeNumber(1_792_316_460_000.0));
        assertEquals(0L, CrateDevicePlugin.wholeNumber(1.5));
        assertEquals(0L, CrateDevicePlugin.wholeNumber("42"));
        assertEquals(0L, CrateDevicePlugin.wholeNumber(null));
        assertEquals(0L, CrateDevicePlugin.wholeNumber(Double.NaN));
    }

    @Test
    public void reportsTheStatusWithoutTheToken() throws Exception {
        JSObject status = CrateDevicePlugin.status(
            DeviceProfileStoreTest.profile("https://api.example", "crv_secret")
        );

        assertTrue(status.getBoolean("hasProfile"));
        assertEquals("server-1", status.getString("serverId"));
        assertEquals("https://api.example", status.getString("serverUrl"));
        assertEquals(42L, status.getLong("tokenId"));
        assertEquals(DeviceProfileStoreTest.EXPIRES_AT_MS, status.getLong("expiresAtMs"));
        assertEquals("device-0123456789", status.getString("deviceId"));
        assertFalse(status.toString().contains("crv_secret"));
        assertFalse(CrateDevicePlugin.status(null).getBoolean("hasProfile"));
    }

    @Test
    public void saysWhyTheProfileWasCleared() throws Exception {
        assertEquals(
            "unauthorized",
            CrateDevicePlugin.changePayload(null, DeviceProfileStore.ClearReason.UNAUTHORIZED)
                .getString("reason")
        );
        assertEquals(
            "cleared",
            CrateDevicePlugin.changePayload(null, DeviceProfileStore.ClearReason.CLEARED)
                .getString("reason")
        );
        assertFalse(
            CrateDevicePlugin.changePayload(
                DeviceProfileStoreTest.profile("https://api.example", "crv_x"),
                null
            ).has("reason")
        );
    }
}
