package app.cratemusic.crate;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.MediaRoute2Info;
import android.media.MediaRouter2;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CrateMediaSession")
public class CrateMediaSessionPlugin extends Plugin {
    private static final String TAG = "CrateMediaSessionPlugin";

    private BroadcastReceiver controlReceiver;
    private volatile MediaRouter2.ControllerCallback routeControllerCallback;

    @Override
    public void load() {
        super.load();
        controlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject payload = new JSObject();
                payload.put("control", intent.getStringExtra(CratePlaybackService.EXTRA_CONTROL));
                if (intent.hasExtra(CratePlaybackService.EXTRA_POSITION)) {
                    payload.put("position", intent.getDoubleExtra(CratePlaybackService.EXTRA_POSITION, 0.0));
                }
                notifyListeners("control", payload, true);
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            controlReceiver,
            new IntentFilter(CratePlaybackService.BROADCAST_CONTROL),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        registerRouteCallback();
    }

    @PluginMethod
    public void start(PluginCall call) {
        sendPlaybackIntent(CratePlaybackService.ACTION_START, call);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        sendPlaybackIntent(CratePlaybackService.ACTION_UPDATE, call);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), CratePlaybackService.class)
            .setAction(CratePlaybackService.ACTION_STOP_SERVICE)
            .putExtra(
                CratePlaybackService.EXTRA_SUPPRESS_CONTROL,
                call.getBoolean("suppressControl", false)
            );
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getOutputCapabilities(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("platform", "android");
        payload.put("canShowSystemOutputSwitcher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE);
        payload.put("canPresentRoutePicker", false);
        payload.put("canReportCurrentRoute", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
        payload.put("routePickerKind", "android-output-switcher");
        call.resolve(payload);
    }

    @PluginMethod
    public void getCurrentRoute(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("route", currentRoutePayload());
        call.resolve(payload);
    }

    @PluginMethod
    public void showSystemOutputSwitcher(PluginCall call) {
        JSObject payload = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            payload.put("shown", false);
            payload.put("reason", "Android output switcher requires Android 14 or newer.");
            call.resolve(payload);
            return;
        }

        boolean shown = false;
        try {
            shown = MediaRouter2.getInstance(getContext()).showSystemOutputSwitcher();
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not open Android output switcher.", error);
            payload.put("reason", "Could not open Android output switcher.");
        }
        payload.put("shown", shown);
        if (!shown && !payload.has("reason")) {
            payload.put("reason", "Android output switcher ignored the request.");
        }
        call.resolve(payload);
    }

    @Override
    protected void handleOnDestroy() {
        if (controlReceiver != null) {
            try {
                getContext().unregisterReceiver(controlReceiver);
            } catch (IllegalArgumentException error) {
                Log.w(TAG, "Control receiver was already unregistered.", error);
            }
            controlReceiver = null;
        }
        unregisterRouteCallback();
        super.handleOnDestroy();
    }

    private void sendPlaybackIntent(String action, PluginCall call) {
        Intent intent = new Intent(getContext(), CratePlaybackService.class)
            .setAction(action)
            .putExtra(CratePlaybackService.EXTRA_TITLE, call.getString("title", "Crate"))
            .putExtra(CratePlaybackService.EXTRA_ARTIST, call.getString("artist", ""))
            .putExtra(CratePlaybackService.EXTRA_ALBUM, call.getString("album", ""))
            .putExtra(CratePlaybackService.EXTRA_ARTWORK, call.getString("artwork", ""))
            .putExtra(CratePlaybackService.EXTRA_IS_PLAYING, call.getBoolean("isPlaying", false))
            .putExtra(CratePlaybackService.EXTRA_POSITION, call.getDouble("position", 0.0))
            .putExtra(CratePlaybackService.EXTRA_DURATION, call.getDouble("duration", 0.0));
        ContextCompat.startForegroundService(getContext(), intent);
    }

    private void registerRouteCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || routeControllerCallback != null) {
            return;
        }
        routeControllerCallback = new MediaRouter2.ControllerCallback() {
            @Override
            public void onControllerUpdated(MediaRouter2.RoutingController controller) {
                notifyRouteChanged();
            }
        };
        MediaRouter2.getInstance(getContext()).registerControllerCallback(
            getContext().getMainExecutor(),
            routeControllerCallback
        );
    }

    private void unregisterRouteCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || routeControllerCallback == null) {
            return;
        }
        try {
            MediaRouter2.getInstance(getContext()).unregisterControllerCallback(routeControllerCallback);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not unregister route callback.", error);
        }
        routeControllerCallback = null;
    }

    private void notifyRouteChanged() {
        JSObject payload = new JSObject();
        payload.put("route", currentRoutePayload());
        notifyListeners("routeChanged", payload, true);
    }

    private JSObject currentRoutePayload() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                MediaRouter2.RoutingController controller =
                    MediaRouter2.getInstance(getContext()).getSystemController();
                java.util.List<MediaRoute2Info> selectedRoutes = controller.getSelectedRoutes();
                if (!selectedRoutes.isEmpty()) {
                    return routePayload(selectedRoutes.get(0));
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not read current Android output route.", error);
            }
        }
        JSObject route = new JSObject();
        route.put("id", "android-system-output");
        route.put("name", "System output");
        route.put("type", "system");
        route.put("platform", "android");
        return route;
    }

    private JSObject routePayload(MediaRoute2Info routeInfo) {
        JSObject route = new JSObject();
        route.put("id", routeInfo.getId());
        route.put("name", String.valueOf(routeInfo.getName()));
        route.put("type", routeType(routeInfo));
        route.put("platform", "android");
        return route;
    }

    private String routeType(MediaRoute2Info routeInfo) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return "system";
        }
        switch (routeInfo.getType()) {
            case MediaRoute2Info.TYPE_BLUETOOTH_A2DP:
            case MediaRoute2Info.TYPE_BLE_HEADSET:
            case MediaRoute2Info.TYPE_HEARING_AID:
                return "bluetooth";
            case MediaRoute2Info.TYPE_BUILTIN_SPEAKER:
                return "speaker";
            case MediaRoute2Info.TYPE_WIRED_HEADSET:
            case MediaRoute2Info.TYPE_WIRED_HEADPHONES:
            case MediaRoute2Info.TYPE_USB_HEADSET:
            case MediaRoute2Info.TYPE_USB_DEVICE:
            case MediaRoute2Info.TYPE_USB_ACCESSORY:
                return "wired";
            case MediaRoute2Info.TYPE_HDMI:
            case MediaRoute2Info.TYPE_HDMI_ARC:
            case MediaRoute2Info.TYPE_HDMI_EARC:
                return "hdmi";
            default:
                return "system";
        }
    }
}
