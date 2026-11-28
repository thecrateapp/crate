package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.google.android.gms.cast.framework.CastState;
import org.junit.Test;

public class NativeCastAvailabilityTest {
    @Test
    public void offersCastBeforeAnyDeviceWasDiscovered() {
        // The SDK only discovers while the Cast dialog is open, so "no devices
        // yet" must not block the button that opens that dialog.
        NativeCastAvailability availability = NativeCastAvailability.describe(
            false,
            false,
            CastState.NO_DEVICES_AVAILABLE
        );

        assertTrue(availability.available);
        assertFalse(availability.devicesKnown);
        assertNull(availability.reason);
    }

    @Test
    public void reportsDiscoveredDevices() {
        NativeCastAvailability availability = NativeCastAvailability.describe(
            false,
            false,
            CastState.NOT_CONNECTED
        );

        assertTrue(availability.available);
        assertTrue(availability.devicesKnown);
    }

    @Test
    public void anActiveSessionIsAvailable() {
        NativeCastAvailability availability = NativeCastAvailability.describe(
            true,
            false,
            CastState.CONNECTED
        );

        assertTrue(availability.available);
        assertTrue(availability.devicesKnown);
        assertNull(availability.reason);
    }

    @Test
    public void explainsTheMissingDiscoveryPermissionWithoutBlocking() {
        NativeCastAvailability availability = NativeCastAvailability.describe(
            false,
            true,
            CastState.NO_DEVICES_AVAILABLE
        );

        assertTrue(availability.available);
        assertEquals(
            "Nearby-device permission is required for Cast discovery.",
            availability.reason
        );
    }
}
