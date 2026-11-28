package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class DeviceTokenRejectionDataSourceTest {
    private static final Uri STREAM = Uri.parse("https://api.example/api/tracks/1/stream");

    private static final class FailingUpstream implements DataSource {
        @Nullable
        IOException failure;

        @Override
        public void addTransferListener(TransferListener transferListener) {}

        @Override
        public long open(DataSpec dataSpec) throws IOException {
            if (failure != null) throw failure;
            return 10L;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) {
            return -1;
        }

        @Nullable
        @Override
        public Uri getUri() {
            return STREAM;
        }

        @Override
        public Map<String, List<String>> getResponseHeaders() {
            return Collections.emptyMap();
        }

        @Override
        public void close() {}
    }

    private static DataSpec authorized(String authorization) {
        return new DataSpec(STREAM)
            .withAdditionalHeaders(Collections.singletonMap("Authorization", authorization));
    }

    private static HttpDataSource.InvalidResponseCodeException status(int code, DataSpec spec) {
        return new HttpDataSource.InvalidResponseCodeException(
            code,
            "status",
            null,
            Collections.emptyMap(),
            spec,
            new byte[0]
        );
    }

    private final FailingUpstream upstream = new FailingUpstream();
    private final List<String> rejected = new ArrayList<>();
    private DataSource source;

    @Before
    public void setUp() {
        source = new DeviceTokenRejectionDataSource.Factory(() -> upstream, rejected::add)
            .createDataSource();
    }

    @Test
    public void reportsTheDeviceTokenA401Or403Refused() {
        for (int code : new int[] {401, 403}) {
            DataSpec spec = authorized("Bearer crv_device");
            upstream.failure = status(code, spec);
            assertThrows(HttpDataSource.InvalidResponseCodeException.class, () -> source.open(spec));
        }

        assertEquals(2, rejected.size());
        assertEquals("crv_device", rejected.get(0));
    }

    @Test
    public void ignoresOtherFailuresAndCredentials() throws Exception {
        DataSpec session = authorized("Bearer eyJ.session.jwt");
        upstream.failure = status(401, session);
        assertThrows(IOException.class, () -> source.open(session));

        DataSpec device = authorized("Bearer crv_device");
        upstream.failure = status(404, device);
        assertThrows(IOException.class, () -> source.open(device));
        upstream.failure = new IOException("offline");
        assertThrows(IOException.class, () -> source.open(device));

        DataSpec anonymous = new DataSpec(STREAM);
        upstream.failure = status(401, anonymous);
        assertThrows(IOException.class, () -> source.open(anonymous));

        upstream.failure = null;
        assertEquals(10L, source.open(device));
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void findsTheStatusThroughWrappedCauses() {
        DataSpec spec = authorized("Bearer crv_device");
        IOException wrapped = new IOException(status(401, spec));

        assertEquals(Integer.valueOf(401), DeviceTokenRejectionDataSource.httpStatus(wrapped));
        assertNull(DeviceTokenRejectionDataSource.httpStatus(new IOException("offline")));
        assertEquals("Bearer crv_device", DeviceTokenRejectionDataSource.authorizationHeader(spec));
    }

    @Test
    public void aRefusedStreamClearsTheMatchingProfileAndTellsJs() throws Exception {
        DeviceProfileStoreTest.preferences().edit().clear().commit();
        DeviceProfileStore store = new DeviceProfileStore(
            DeviceProfileStoreTest.preferences(),
            new DeviceProfileStoreTest.FakeCodec(),
            false
        );
        store.save(DeviceProfileStoreTest.profile("https://api.example", "crv_device"));
        List<String> reasons = new ArrayList<>();
        store.addListener((profile, reason) -> {
            if (profile == null) reasons.add(String.valueOf(reason));
        });
        DataSource clearing = new DeviceTokenRejectionDataSource.Factory(
            () -> upstream,
            token -> store.clearIfToken(token, DeviceProfileStore.ClearReason.UNAUTHORIZED)
        ).createDataSource();

        // A refusal of an older token leaves the current profile alone.
        DataSpec older = authorized("Bearer crv_older");
        upstream.failure = status(401, older);
        assertThrows(IOException.class, () -> clearing.open(older));
        assertNotNull(store.current());

        DataSpec current = authorized("Bearer crv_device");
        upstream.failure = status(403, current);
        assertThrows(IOException.class, () -> clearing.open(current));

        assertNull(store.current());
        assertEquals(Collections.singletonList("UNAUTHORIZED"), reasons);
        // The retry goes out without the device token: the session path applies.
        assertNull(store.tokenFor(STREAM.toString(), 0L));
    }
}
