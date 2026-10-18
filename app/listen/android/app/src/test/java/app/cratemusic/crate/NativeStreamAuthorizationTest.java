package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

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
}
