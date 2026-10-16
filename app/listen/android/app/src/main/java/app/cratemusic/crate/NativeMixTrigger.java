package app.cratemusic.crate;

final class NativeMixTrigger {
    static final long STANDBY_BUFFER_MARGIN_MS = 1_000L;
    static final long MINIMUM_TRANSITION_MS = 1_000L;
    static final long START_SAFETY_LEAD_MS = 50L;
    private static final long ACTIVE_CHECK_MS = 20L;
    private static final long IDLE_CHECK_MS = 1_000L;

    enum Action {
        WAIT,
        START,
        FALL_BACK
    }

    static final class Decision {
        final Action action;
        final long durationMs;
        final long nextCheckDelayMs;

        private Decision(Action action, long durationMs, long nextCheckDelayMs) {
            this.action = action;
            this.durationMs = durationMs;
            this.nextCheckDelayMs = nextCheckDelayMs;
        }
    }

    private NativeMixTrigger() {}

    static Decision evaluate(
        boolean isPlaying,
        long positionMs,
        long outgoingDurationMs,
        NativeTransitionPlan plan,
        boolean standbyReady
    ) {
        if (
            plan == null ||
            plan.mode == NativeTransitionPlan.Mode.GAPLESS ||
            plan.durationMs <= 0L
        ) {
            return new Decision(Action.FALL_BACK, 0L, IDLE_CHECK_MS);
        }
        if (!isPlaying || outgoingDurationMs <= 0L) {
            return new Decision(Action.WAIT, 0L, IDLE_CHECK_MS);
        }
        long safePositionMs = Math.max(0L, positionMs);
        long cueMs = effectiveCueMs(plan, outgoingDurationMs);
        long untilStartMs = cueMs - START_SAFETY_LEAD_MS - safePositionMs;
        if (untilStartMs > 0L) {
            return new Decision(
                Action.WAIT,
                0L,
                Math.max(ACTIVE_CHECK_MS, Math.min(IDLE_CHECK_MS, untilStartMs))
            );
        }
        long startMs = Math.max(cueMs, safePositionMs);
        long durationMs = Math.min(
            plan.durationMs,
            outgoingDurationMs - startMs - START_SAFETY_LEAD_MS
        );
        if (durationMs < Math.min(plan.durationMs, MINIMUM_TRANSITION_MS)) {
            return new Decision(Action.FALL_BACK, 0L, IDLE_CHECK_MS);
        }
        if (!standbyReady) {
            return new Decision(Action.WAIT, 0L, ACTIVE_CHECK_MS);
        }
        return new Decision(Action.START, durationMs, ACTIVE_CHECK_MS);
    }

    static long effectiveCueMs(NativeTransitionPlan plan, long outgoingDurationMs) {
        long latestCueMs = Math.max(
            0L,
            outgoingDurationMs - plan.durationMs - START_SAFETY_LEAD_MS
        );
        if (plan.outgoingCueMs <= 0L) {
            return latestCueMs;
        }
        return Math.min(plan.outgoingCueMs, latestCueMs);
    }
}
