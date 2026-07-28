package app.cratemusic.crate;

import android.media.AudioManager;
import android.os.Bundle;

import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.BridgeActivity;

@UnstableApi
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CrateMediaSessionPlugin.class);
        registerPlugin(CrateCastPlugin.class);
        registerPlugin(CrateNativePlaybackPlugin.class);
        registerPlugin(CrateSocialSharePlugin.class);
        registerPlugin(CrateSecureSessionPlugin.class);
        registerPlugin(CrateOfflineIntegrityPlugin.class);
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
    }

    @Override
    public void onResume() {
        super.onResume();
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
    }
}
