package app.cratemusic.crate;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "CrateOfflineIntegrity")
public class CrateOfflineIntegrityPlugin extends Plugin {
    private static final int MAX_BATCH_SIZE = 500;
    private final ExecutorService verifierExecutor =
        Executors.newSingleThreadExecutor();

    @PluginMethod
    public void verifyAssets(PluginCall call) {
        JSArray assets = call.getArray("assets");
        if (assets == null || assets.length() > MAX_BATCH_SIZE) {
            call.reject("Offline integrity batch is invalid");
            return;
        }
        verifierExecutor.execute(() -> {
            JSArray results = new JSArray();
            for (int index = 0; index < assets.length(); index += 1) {
                JSONObject input = assets.optJSONObject(index);
                if (input == null) continue;
                OfflineAssetVerifier.Result result = OfflineAssetVerifier.verify(
                    getContext().getFilesDir(),
                    input.optString("path", ""),
                    input.optLong("expectedBytes", 0)
                );
                JSObject payload = new JSObject();
                payload.put("path", result.path);
                payload.put("exists", result.exists);
                payload.put("size", result.size);
                payload.put("valid", result.valid);
                results.put(payload);
            }
            JSObject response = new JSObject();
            response.put("assets", results);
            call.resolve(response);
        });
    }

    @Override
    protected void handleOnDestroy() {
        verifierExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
