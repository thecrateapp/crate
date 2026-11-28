package app.cratemusic.crate;

import androidx.annotation.Nullable;

import com.google.android.gms.cast.framework.CastState;

/**
 * Whether Listen may offer Google Cast, given the framework's state.
 *
 * <p>The Cast framework discovers devices only while the Cast dialog is open,
 * while it recovers a session, and occasionally when the app comes to the
 * foreground; since 2023 it starts discovery without user action even less
 * often. {@link CastState#NO_DEVICES_AVAILABLE} therefore usually means
 * "nobody looked yet", not "no receivers here". Gating the Cast target on it
 * left the button that opens the dialog, and starts discovery, permanently
 * disabled. Cast is offered whenever the framework is usable; the dialog
 * reports when it finds nothing.
 */
final class NativeCastAvailability {
    static final String PERMISSION_REASON =
        "Nearby-device permission is required for Cast discovery.";

    final boolean available;
    /** Whether the framework has seen a receiver; informational only. */
    final boolean devicesKnown;
    @Nullable
    final String reason;

    private NativeCastAvailability(boolean available, boolean devicesKnown, @Nullable String reason) {
        this.available = available;
        this.devicesKnown = devicesKnown;
        this.reason = reason;
    }

    static NativeCastAvailability describe(
        boolean activeSession,
        boolean permissionRequired,
        int castState
    ) {
        boolean devicesKnown = activeSession || castState != CastState.NO_DEVICES_AVAILABLE;
        return new NativeCastAvailability(
            true,
            devicesKnown,
            permissionRequired && !activeSession ? PERMISSION_REASON : null
        );
    }
}
