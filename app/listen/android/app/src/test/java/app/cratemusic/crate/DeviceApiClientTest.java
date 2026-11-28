package app.cratemusic.crate;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class DeviceApiClientTest {
    private static final class RecordingTransport implements DeviceApiClient.Transport {
        final List<DeviceApiClient.Request> requests = new ArrayList<>();
        DeviceApiClient.Response response = new DeviceApiClient.Response(200, "{\"ok\":true}");
        IOException failure;

        @Override
        public DeviceApiClient.Response execute(DeviceApiClient.Request request) throws IOException {
            requests.add(request);
            if (failure != null) throw failure;
            return response;
        }
    }

    private static final class FakeConnection extends HttpURLConnection {
        final ByteArrayOutputStream written = new ByteArrayOutputStream();
        final int status;
        final String body;
        boolean disconnected = false;

        FakeConnection(URL url, int status, String body) {
            super(url);
            this.status = status;
            this.body = body;
        }

        @Override
        public void connect() {}

        @Override
        public void disconnect() {
            disconnected = true;
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public OutputStream getOutputStream() {
            return written;
        }

        @Override
        public int getResponseCode() {
            return status;
        }

        @Override
        public InputStream getInputStream() throws IOException {
            if (status >= 400) throw new IOException("error status");
            return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public InputStream getErrorStream() {
            return status >= 400 ? new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)) : null;
        }
    }

    private final RecordingTransport transport = new RecordingTransport();
    private final List<String> signIns = new ArrayList<>();
    private DeviceProfileStore store;
    private DeviceApiClient client;
    private long now = 0L;

    @Before
    public void setUp() throws Exception {
        DeviceProfileStoreTest.preferences().edit().clear().commit();
        store = new DeviceProfileStore(
            DeviceProfileStoreTest.preferences(),
            new DeviceProfileStoreTest.FakeCodec(),
            false
        );
        store.save(DeviceProfileStoreTest.profile("https://api.example/", "crv_device"));
        client = new DeviceApiClient(store, transport, () -> now);
        client.addSignInListener(() -> signIns.add("sign-in"));
    }

    @Test
    public void buildsRequestsWithTheDeviceBearer() {
        DeviceProfileStore.Profile profile = store.current();
        DeviceApiClient.Request get = DeviceApiClient.buildRequest(profile, "GET", "/api/auth/me", null);
        DeviceApiClient.Request post = DeviceApiClient.buildRequest(profile, "POST", "/api/me/play-events", "{}");

        assertEquals("https://api.example/api/auth/me", get.url);
        assertEquals("Bearer crv_device", get.headers.get("Authorization"));
        assertEquals("application/json", get.headers.get("Accept"));
        assertFalse(get.headers.containsKey("Content-Type"));
        assertEquals("application/json", post.headers.get("Content-Type"));
        assertEquals("{}", post.body);
        assertFalse(get.toString().contains("crv_device"));
        assertNull(DeviceApiClient.buildRequest(profile, "GET", "auth/me", null));
        assertNull(DeviceApiClient.buildRequest(profile, "GET", "/api/../admin", null));
        assertNull(DeviceApiClient.buildRequest(profile, "GET", "/api/x?u=https://evil", null));
    }

    @Test
    public void returnsJsonFromASuccessfulRequest() throws Exception {
        DeviceApiClient.Result result = client.post("/api/me/play-events", new JSONObject().put("a", 1));

        assertTrue(result.isOk());
        assertTrue(result.json().getBoolean("ok"));
        assertEquals("POST", transport.requests.get(0).method);
        assertEquals("{\"a\":1}", transport.requests.get(0).body);
    }

    @Test
    public void doesNotCallTheServerWithoutAUsableProfile() {
        now = DeviceProfileStoreTest.EXPIRES_AT_MS;
        assertEquals(DeviceApiClient.Outcome.NO_PROFILE, client.get("/api/auth/me").outcome);
        store.clear(DeviceProfileStore.ClearReason.CLEARED);
        now = 0L;
        assertEquals(DeviceApiClient.Outcome.NO_PROFILE, client.get("/api/auth/me").outcome);
        assertTrue(transport.requests.isEmpty());
    }

    @Test
    public void rejectsPathsOutsideTheApi() {
        assertThrows(IllegalArgumentException.class, () -> client.get("/admin"));
    }

    @Test
    public void clearsTheProfileAndAsksForSignInOn401() {
        transport.response = new DeviceApiClient.Response(401, "{\"detail\":\"Not authenticated\"}");

        DeviceApiClient.Result result = client.get("/api/auth/me");

        assertEquals(DeviceApiClient.Outcome.UNAUTHORIZED, result.outcome);
        assertNull(store.current());
        assertEquals(1, signIns.size());
        assertNull(result.json());
    }

    @Test
    public void keepsANewerProfileWhenAnOldTokenGets401() throws Exception {
        transport.response = new DeviceApiClient.Response(401, "");
        DeviceApiClient.Transport racing = request -> {
            // JS mints a new token while the old request is in flight.
            try {
                store.save(DeviceProfileStoreTest.profile("https://api.example", "crv_newer"));
            } catch (Exception error) {
                throw new IOException(error);
            }
            return transport.execute(request);
        };
        DeviceApiClient racingClient = new DeviceApiClient(store, racing, () -> now);

        racingClient.get("/api/auth/me");

        assertNotNull(store.current());
        assertEquals("crv_newer", store.current().deviceToken);
    }

    @Test
    public void keepsTheProfileOn403AndOtherErrors() {
        transport.response = new DeviceApiClient.Response(403, "");
        assertEquals(DeviceApiClient.Outcome.FORBIDDEN, client.get("/api/auth/me").outcome);
        transport.response = new DeviceApiClient.Response(503, "");
        assertEquals(DeviceApiClient.Outcome.HTTP_ERROR, client.get("/api/auth/me").outcome);
        transport.failure = new IOException("offline");
        assertEquals(DeviceApiClient.Outcome.NETWORK_ERROR, client.get("/api/auth/me").outcome);
        assertNotNull(store.current());
        assertTrue(signIns.isEmpty());
    }

    @Test
    public void httpTransportSetsTimeoutsHeadersAndNoRedirects() throws Exception {
        List<FakeConnection> opened = new ArrayList<>();
        DeviceApiClient.Transport http = DeviceApiClient.httpTransport(url -> {
            FakeConnection connection = new FakeConnection(url, 200, "{\"id\":7}");
            opened.add(connection);
            return connection;
        });
        DeviceApiClient.Request request = DeviceApiClient.buildRequest(
            store.current(), "POST", "/api/me/play-events", "{\"a\":1}"
        );

        DeviceApiClient.Response response = http.execute(request);

        FakeConnection connection = opened.get(0);
        assertEquals(200, response.status);
        assertEquals("{\"id\":7}", response.body);
        assertEquals("POST", connection.getRequestMethod());
        assertEquals(DeviceApiClient.CONNECT_TIMEOUT_MS, connection.getConnectTimeout());
        assertEquals(DeviceApiClient.READ_TIMEOUT_MS, connection.getReadTimeout());
        assertFalse(connection.getInstanceFollowRedirects());
        assertEquals("Bearer crv_device", connection.getRequestProperty("Authorization"));
        assertEquals("application/json", connection.getRequestProperty("Content-Type"));
        assertEquals("{\"a\":1}", connection.written.toString("UTF-8"));
        assertTrue(connection.disconnected);
    }

    @Test
    public void httpTransportReadsTheErrorBody() throws Exception {
        DeviceApiClient.Transport http = DeviceApiClient.httpTransport(
            url -> new FakeConnection(url, 401, "{\"detail\":\"no\"}")
        );
        DeviceApiClient.Response response = http.execute(
            DeviceApiClient.buildRequest(store.current(), "GET", "/api/auth/me", null)
        );

        assertEquals(401, response.status);
        assertEquals("{\"detail\":\"no\"}", response.body);
    }
}
