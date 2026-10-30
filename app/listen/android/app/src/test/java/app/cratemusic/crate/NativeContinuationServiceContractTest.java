package app.cratemusic.crate;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.Looper;
import android.os.Handler;
import android.os.SystemClock;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowSystemClock;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
public class NativeContinuationServiceContractTest {
    private CrateNativePlaybackService service;
    private NativeContinuationPolicy refill;
    private NativeContinuationPolicy plans;

    private static final class EndedPlayer extends SimpleBasePlayer {
        EndedPlayer() { super(Looper.getMainLooper()); }
        @Override protected State getState() {
            return new State.Builder()
                .setAvailableCommands(new Player.Commands.Builder().addAllCommands().build())
                .setPlayWhenReady(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                .setPlaybackState(Player.STATE_ENDED)
                .build();
        }
    }

    private Object field(String name) throws Exception {
        Field field = CrateNativePlaybackService.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(service);
    }

    private void setField(String name, Object value) throws Exception {
        Field field = CrateNativePlaybackService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(service, value);
    }

    private NativeContinuationClient.Config config(String token, String session, boolean authoritative)
        throws Exception {
        return NativeContinuationClient.Config.fromJson(new JSONObject()
            .put("apiBase", "https://example.test")
            .put("token", token)
            .put("expiresAtMs", Long.MAX_VALUE)
            .put("refill", true)
            .put("sessionId", session)
            .put("batchIndex", 4)
            .put("authoritativeCursor", authoritative));
    }

    @Before public void setUp() throws Exception {
        service = Robolectric.buildService(CrateNativePlaybackService.class).get();
        setField("player", new CrateMixPlayer(new EndedPlayer()));
        setField("audioManager", RuntimeEnvironment.getApplication().getSystemService(Context.AUDIO_SERVICE));
        setField("audioFocusHeld", true);
        refill = (NativeContinuationPolicy) field("refillPolicy");
        plans = (NativeContinuationPolicy) field("continuationPolicy");
    }

    @Test public void sameConfigurationKeepsExhaustionAcrossForegroundAndReconfiguration() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        refill.onExhausted();
        plans.onUnauthorized();
        service.setAppInForeground(true);
        service.setContinuationConfig(config("token", "session", false));
        assertTrue(refill.isTerminal());
        assertTrue(plans.isTerminal());
        assertFalse((boolean) field("audioFocusHeld"));
        assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
    }

    @Test public void sameConfigurationKeepsBackoffAndInvalidatesOldWork() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        refill.onFailure(SystemClock.elapsedRealtime());
        plans.onFailure(SystemClock.elapsedRealtime());
        long generation = refill.generation();
        ShadowSystemClock.advanceBy(Duration.ofSeconds(5));
        service.setAppInForeground(true);
        service.setContinuationConfig(config("token", "session", false));
        assertEquals(5_000L, refill.retryDelayMs(SystemClock.elapsedRealtime()));
        assertEquals(5_000L, plans.retryDelayMs(SystemClock.elapsedRealtime()));
        assertFalse(refill.acceptsResult(generation));
    }

    @Test public void sameConfigurationDoesNotRestartTheEndedDeadline() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        ShadowSystemClock.advanceBy(Duration.ofSeconds(45));
        service.setAppInForeground(true);
        service.setContinuationConfig(config("token", "session", false));
        assertEquals(15_000L, refill.remainingEndedWaitMs(SystemClock.elapsedRealtime()));
    }

    @Test public void sameConfigurationKeepsTheBackgroundRetryScheduled() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        refill.onFailure(SystemClock.elapsedRealtime());
        service.setAppInForeground(false);
        Handler handler = (Handler) field("mainHandler");
        Runnable retry = (Runnable) field("refillRetry");
        assertTrue(handler.hasCallbacks(retry));
        service.setContinuationConfig(config("token", "session", false));
        assertTrue(handler.hasCallbacks(retry));
    }

    @Test public void changedTokenSessionOrAuthoritativeCursorStartsAFreshPolicy() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        for (NativeContinuationClient.Config next : new NativeContinuationClient.Config[] {
            config("new-token", "session", false),
            config("new-token", "new-session", false),
            config("new-token", "new-session", true)
        }) {
            refill.onExhausted();
            plans.onUnauthorized();
            service.setContinuationConfig(next);
            assertFalse(refill.isTerminal());
            assertFalse(plans.isTerminal());
            assertEquals(60_000L, refill.remainingEndedWaitMs(SystemClock.elapsedRealtime()));
        }
    }

    private void settle() throws Exception {
        Method settle = CrateNativePlaybackService.class.getDeclaredMethod("settleEndedPlayback");
        settle.setAccessible(true);
        settle.invoke(service);
    }

    @Test public void finiteEndedPlaybackReleasesFocusWithoutStoppingTheMediaSession() throws Exception {
        settle();
        assertFalse((boolean) field("audioFocusHeld"));
        assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
    }

    @Test public void continuationDeadlineReleasesFocusAndStopsTheService() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(60));
        assertFalse((boolean) field("audioFocusHeld"));
        assertTrue(Shadows.shadowOf(service).isStoppedBySelf());
        assertTrue(refill.endedDeadlineExpired(SystemClock.elapsedRealtime()));
    }

    @Test public void clearingConfigurationSettlesEndedPlaybackWithoutStoppingControls() throws Exception {
        service.setContinuationConfig(config("token", "session", false));
        service.setContinuationConfig(null);
        assertFalse((boolean) field("audioFocusHeld"));
        assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
    }
}
