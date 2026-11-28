package app.cratemusic.crate;

import androidx.annotation.Nullable;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

// The native client for the device API: base URL and Bearer device token
// from the active DeviceProfileStore profile. A 401 means the device token
// (and its session) is gone: the profile is cleared and listeners are told,
// so the service can ask the listener to open Crate on the phone. The token
// is only ever sent in the Authorization header and never logged.
final class DeviceApiClient {
    static final int CONNECT_TIMEOUT_MS = 10_000;
    static final int READ_TIMEOUT_MS = 15_000;

    interface SignInListener {
        void onSignInRequired();
    }

    static final class Request {
        final String method;
        final String url;
        final Map<String, String> headers;
        @Nullable
        final String body;

        Request(String method, String url, Map<String, String> headers, @Nullable String body) {
            this.method = method;
            this.url = url;
            this.headers = Collections.unmodifiableMap(new LinkedHashMap<>(headers));
            this.body = body;
        }

        @Override
        public String toString() {
            // The Authorization header stays out of logs and crash reports.
            return method + " " + url;
        }
    }

    interface Transport {
        Response execute(Request request) throws IOException;
    }

    static final class Response {
        final int status;
        final String body;

        Response(int status, String body) {
            this.status = status;
            this.body = body == null ? "" : body;
        }
    }

    enum Outcome {
        OK,
        NO_PROFILE,
        UNAUTHORIZED,
        FORBIDDEN,
        HTTP_ERROR,
        NETWORK_ERROR
    }

    static final class Result {
        final Outcome outcome;
        final int status;
        final String body;

        Result(Outcome outcome, int status, String body) {
            this.outcome = outcome;
            this.status = status;
            this.body = body == null ? "" : body;
        }

        boolean isOk() {
            return outcome == Outcome.OK;
        }

        @Nullable
        JSONObject json() {
            if (!isOk() || body.isEmpty()) return null;
            try {
                return new JSONObject(body);
            } catch (JSONException error) {
                return null;
            }
        }
    }

    interface Clock {
        long nowWallMs();
    }

    private final DeviceProfileStore store;
    private final Transport transport;
    private final Clock clock;
    private final CopyOnWriteArrayList<SignInListener> listeners = new CopyOnWriteArrayList<>();

    DeviceApiClient(DeviceProfileStore store) {
        this(store, httpTransport(), System::currentTimeMillis);
    }

    DeviceApiClient(DeviceProfileStore store, Transport transport, Clock clock) {
        this.store = store;
        this.transport = transport;
        this.clock = clock;
    }

    void addSignInListener(SignInListener listener) {
        listeners.addIfAbsent(listener);
    }

    void removeSignInListener(SignInListener listener) {
        listeners.remove(listener);
    }

    Result get(String path) {
        return send("GET", path, null);
    }

    Result post(String path, JSONObject body) {
        return send("POST", path, body.toString());
    }

    // The request for path under the profile's server, or null when the path
    // is not an API path.
    @Nullable
    static Request buildRequest(
        DeviceProfileStore.Profile profile,
        String method,
        String path,
        @Nullable String body
    ) {
        if (path == null || !path.startsWith("/api/") || path.contains("..") || path.contains("://")) {
            return null;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + profile.deviceToken);
        headers.put("Accept", "application/json");
        if (body != null) headers.put("Content-Type", "application/json");
        return new Request(method, profile.serverUrl + path, headers, body);
    }

    private Result send(String method, String path, @Nullable String body) {
        DeviceProfileStore.Profile profile = store.current();
        if (profile == null || profile.isExpired(clock.nowWallMs())) {
            return new Result(Outcome.NO_PROFILE, 0, "");
        }
        Request request = buildRequest(profile, method, path, body);
        if (request == null) {
            throw new IllegalArgumentException("Device API paths start with /api/");
        }
        Response response;
        try {
            response = transport.execute(request);
        } catch (IOException error) {
            return new Result(Outcome.NETWORK_ERROR, 0, "");
        }
        if (response.status == 401) {
            if (store.clearIfToken(profile.deviceToken, DeviceProfileStore.ClearReason.UNAUTHORIZED)) {
                for (SignInListener listener : listeners) listener.onSignInRequired();
            }
            return new Result(Outcome.UNAUTHORIZED, response.status, response.body);
        }
        if (response.status == 403) {
            return new Result(Outcome.FORBIDDEN, response.status, response.body);
        }
        if (response.status < 200 || response.status >= 300) {
            return new Result(Outcome.HTTP_ERROR, response.status, response.body);
        }
        return new Result(Outcome.OK, response.status, response.body);
    }

    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    static Transport httpTransport() {
        return httpTransport(url -> (HttpURLConnection) url.openConnection());
    }

    static Transport httpTransport(ConnectionFactory factory) {
        return request -> {
            HttpURLConnection connection = factory.open(new URL(request.url));
            try {
                connection.setRequestMethod(request.method);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                // A redirect must not carry the device token to another host.
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                for (Map.Entry<String, String> header : request.headers.entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
                if (request.body != null) {
                    connection.setDoOutput(true);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(request.body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
                return new Response(status, readFully(stream));
            } finally {
                connection.disconnect();
            }
        };
    }

    private static String readFully(@Nullable InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream input = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
        }
    }
}
