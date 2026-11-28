package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.Test;

public class NativeStreamAuthorizationTest {
    private static final long EXP_SECONDS = 1_792_316_460L;
    private static final long EXP_MS = EXP_SECONDS * 1000L;

    private static String sessionBearer(long expSeconds) {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString("{\"alg\":\"HS256\"}".getBytes(StandardCharsets.UTF_8));
        String payload = encoder.encodeToString(
            ("{\"user_id\":1,\"sid\":\"s\",\"exp\":" + expSeconds + "}")
                .getBytes(StandardCharsets.UTF_8)
        );
        return "Bearer " + header + "." + payload + ".signature";
    }

    @Test
    public void readsTheExpiryOfASessionBearer() {
        assertEquals(EXP_MS, NativeStreamAuthorization.bearerExpiryMs(sessionBearer(EXP_SECONDS)));
        assertEquals(0L, NativeStreamAuthorization.bearerExpiryMs("Bearer not-a-jwt"));
        assertEquals(0L, NativeStreamAuthorization.bearerExpiryMs("Basic abc"));
    }

    @Test
    public void keepsTheSessionBearerWhileItIsValid() {
        String session = sessionBearer(EXP_SECONDS);

        assertEquals(
            session,
            NativeStreamAuthorization.choose(session, "crv_continuation", EXP_MS - 120_000L)
        );
    }

    @Test
    public void switchesToTheContinuationTokenNearSessionExpiry() {
        String session = sessionBearer(EXP_SECONDS);

        assertEquals(
            "Bearer crv_continuation",
            NativeStreamAuthorization.choose(session, "crv_continuation", EXP_MS - 30_000L)
        );
        assertEquals(
            "Bearer crv_continuation",
            NativeStreamAuthorization.choose("Bearer opaque", "crv_continuation", 0L)
        );
    }

    @Test
    public void keepsTheSessionBearerWithoutAContinuationToken() {
        String session = sessionBearer(EXP_SECONDS);

        assertEquals(session, NativeStreamAuthorization.choose(session, null, EXP_MS + 1L));
        assertNull(NativeStreamAuthorization.choose(null, "", 0L));
    }

    @Test
    public void knowsTheStreamAndArtworkRoutesOfTheDeviceToken() {
        String uid = "0b7c5a2e-1f53-4f06-9c55-3f1e6c3b8a10";
        assertTrue(NativeStreamAuthorization.deviceTokenCoversStream("/api/tracks/by-entity/" + uid + "/stream"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversStream("/api/catalog/tracks/" + uid + "/stream"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversStream("/api/tracks/12/stream"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversStream("/api/stream/Artist/Album/01.flac"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversStream("/api/playback/variants/v1/stream"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversStream("/api/federation/remote/streams/t1"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversStream("/api/tracks/by-entity/../stream"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversStream("/api/tracks/12/playback"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversStream(null));

        assertTrue(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/albums/3/cover"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/albums/by-entity/" + uid + "/cover"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/catalog/albums/" + uid + "/cover"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/artists/3/photo"));
        assertTrue(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/artists/by-entity/" + uid + "/background"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/albums/3"));
        assertFalse(NativeStreamAuthorization.deviceTokenCoversArtwork("/api/tracks/12/stream"));
    }

    @Test
    public void streamsWithTheDeviceTokenWheneverItCoversTheRoute() {
        String session = sessionBearer(EXP_SECONDS);

        assertEquals(
            "Bearer crv_device",
            NativeStreamAuthorization.chooseStream(
                "/api/tracks/12/stream", "crv_device", session, "crv_continuation", EXP_MS - 120_000L
            )
        );
        assertEquals(
            "Bearer crv_device",
            NativeStreamAuthorization.chooseStream("/api/tracks/12/stream", "crv_device", null, null, 0L)
        );
    }

    @Test
    public void keepsTheSessionPathWithoutADeviceTokenOrOutsideItsRoutes() {
        String session = sessionBearer(EXP_SECONDS);

        assertEquals(
            session,
            NativeStreamAuthorization.chooseStream(
                "/api/federation/remote/streams/t1", "crv_device", session, null, EXP_MS - 120_000L
            )
        );
        assertEquals(
            session,
            NativeStreamAuthorization.chooseStream("/api/tracks/12/stream", null, session, null, 0L)
        );
        assertEquals(
            "Bearer crv_continuation",
            NativeStreamAuthorization.chooseStream(
                "/api/tracks/12/stream", "", session, "crv_continuation", EXP_MS - 30_000L
            )
        );
    }

    @Test
    public void authorizesArtworkWithTheDeviceTokenOnItsRoutes() {
        assertEquals(
            "Bearer crv_device",
            NativeStreamAuthorization.chooseArtwork("/api/albums/3/cover", "crv_device", "Bearer s")
        );
        assertEquals(
            "Bearer s",
            NativeStreamAuthorization.chooseArtwork("/api/albums/3/cover", null, "Bearer s")
        );
        assertEquals(
            "Bearer s",
            NativeStreamAuthorization.chooseArtwork("/api/me/avatar", "crv_device", "Bearer s")
        );
    }

    @Test
    public void namesTheDeviceTokenOnlyFor401And403WithADeviceBearer() {
        assertEquals("crv_device", NativeStreamAuthorization.rejectedDeviceToken(401, "Bearer crv_device"));
        assertEquals("crv_device", NativeStreamAuthorization.rejectedDeviceToken(403, "Bearer crv_device"));
        assertNull(NativeStreamAuthorization.rejectedDeviceToken(404, "Bearer crv_device"));
        assertNull(NativeStreamAuthorization.rejectedDeviceToken(null, "Bearer crv_device"));
        assertNull(NativeStreamAuthorization.rejectedDeviceToken(401, sessionBearer(EXP_SECONDS)));
        assertNull(NativeStreamAuthorization.rejectedDeviceToken(401, null));
    }
}
