package app.cratemusic.crate;

import androidx.annotation.Nullable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// JS hands the native device profile to the playback service through this
// plugin: after sign-in, on server switch, when the delivery preference or
// the offline profile changes, and on logout. getStatus never returns the
// token.
@CapacitorPlugin(name = "CrateDevice")
public class CrateDevicePlugin extends Plugin {
    static final String PROFILE_CHANGED_EVENT = "profileChanged";

    @Nullable
    private DeviceProfileStore store;
    private final DeviceProfileStore.Listener profileListener =
        (profile, reason) -> notifyListeners(PROFILE_CHANGED_EVENT, changePayload(profile, reason));

    @Override
    public void load() {
        store = DeviceProfileStore.get(getContext());
        store.addListener(profileListener);
    }

    @Override
    protected void handleOnDestroy() {
        if (store != null) store.removeListener(profileListener);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void setProfile(PluginCall call) {
        DeviceProfileStore current = store();
        DeviceProfileStore.Profile profile = DeviceProfileStore.Profile.create(
            call.getString("serverUrl"),
            call.getString("serverId"),
            call.getString("deviceToken"),
            wholeNumber(call.getData().opt("tokenId")),
            wholeNumber(call.getData().opt("expiresAtMs")),
            call.getString("deliveryPolicy"),
            call.getString("offlineProfileKey"),
            call.getString("deviceId"),
            current.allowsLoopbackHttp()
        );
        if (profile == null) {
            call.reject("Invalid device profile");
            return;
        }
        try {
            current.save(profile);
            call.resolve(status(profile));
        } catch (Exception error) {
            call.reject("Device profile storage is unavailable");
        }
    }

    @PluginMethod
    public void updateProfile(PluginCall call) {
        String deliveryPolicy = call.getString("deliveryPolicy");
        boolean replaceOfflineKey = call.getData().has("offlineProfileKey");
        String offlineProfileKey = replaceOfflineKey ? call.getString("offlineProfileKey") : null;
        try {
            DeviceProfileStore.Profile updated = store().updatePreferences(
                deliveryPolicy,
                replaceOfflineKey,
                offlineProfileKey
            );
            call.resolve(status(updated));
        } catch (Exception error) {
            call.reject("Device profile storage is unavailable");
        }
    }

    @PluginMethod
    public void clearProfile(PluginCall call) {
        if (store().clear(DeviceProfileStore.ClearReason.CLEARED)) {
            call.resolve(status(null));
        } else {
            call.reject("Device profile storage is unavailable");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(store().current()));
    }

    private DeviceProfileStore store() {
        if (store == null) store = DeviceProfileStore.get(getContext());
        return store;
    }

    // The bridge parses JS numbers as Integer, Long or Double; anything that
    // is not a whole number counts as missing.
    static long wholeNumber(@Nullable Object value) {
        if (!(value instanceof Number)) return 0L;
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number) || number != Math.floor(number)) {
            return 0L;
        }
        return ((Number) value).longValue();
    }

    static JSObject status(@Nullable DeviceProfileStore.Profile profile) {
        JSObject result = new JSObject();
        result.put("hasProfile", profile != null);
        if (profile == null) return result;
        result.put("serverId", profile.serverId);
        result.put("serverUrl", profile.serverUrl);
        result.put("tokenId", profile.tokenId);
        result.put("expiresAtMs", profile.expiresAtMs);
        result.put("deliveryPolicy", profile.deliveryPolicy);
        if (profile.offlineProfileKey != null) {
            result.put("offlineProfileKey", profile.offlineProfileKey);
        }
        if (profile.deviceId != null) result.put("deviceId", profile.deviceId);
        return result;
    }

    static JSObject changePayload(
        @Nullable DeviceProfileStore.Profile profile,
        @Nullable DeviceProfileStore.ClearReason reason
    ) {
        JSObject payload = status(profile);
        if (profile == null && reason != null) {
            payload.put(
                "reason",
                reason == DeviceProfileStore.ClearReason.UNAUTHORIZED ? "unauthorized" : "cleared"
            );
        }
        return payload;
    }
}
